require('dotenv').config();
const Web3 = require('web3');
const { ChainId, Token, TokenAmount, Pair, Fetcher } = require('@uniswap/sdk');
const abis = require('./abis');
const { mainnet: addresses } = require('./addresses');

// Slippage (in Kyber): the more with buy, the more costly it is

const web3 = new Web3(
    new Web3.providers.WebsocketProvider(process.env.INFURA_URL)
);
web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY);

const kyber = new web3.eth.Contract(
    abis.kyber.kyberNetworkProxy,
    addresses.kyber.kyberNetworkProxy
);

// TODO: ETH_PRICE should be regularly updated
const AMOUNT_ETH = 100; // balance between too low to make profit vs. too low to make slipage
const RECENT_ETH_PRICE = 750; // price in dollars
const AMOUNT_ETH_WEI = web3.utils.toWei(AMOUNT_ETH.toString());
const AMOUNT_DAI_WEI = web3.utils.toWei((AMOUNT_ETH * RECENT_ETH_PRICE).toString()); // amount eth * price dollars


const init = async () => {

    try {
        // Create DAI and WETH tokens (Uniswaps trades with WETH, but not ETH)
        const [dai, weth] = await Promise.all( 
            [addresses.tokens.dai, addresses.tokens.weth].map(tokenAddress => (
                new Token(
                    ChainId.MAINNET,
                    tokenAddress,
                    18
                )
            ))
        );

        // Create DAI-WETH pair
        const daiWeth = await Fetcher.fetchPairData(
            dai,
            weth
        );

        web3.eth.subscribe('newBlockHeaders')
            .on('data', async block => {
                console.log(`New block received. Block # ${block.number}`);

                const kyberResults = await Promise.all([
                    // DAI to ETH: 100 DAI tokens can be converted to X ETH tokens
                    kyber
                        .methods
                        .getExpectedRate(
                            addresses.tokens.dai, // source ERC20 token contract address
                            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', // destination ERC20 token contract address (ETH)
                            AMOUNT_DAI_WEI // wei amount of source ERC20 token
                        )
                        .call(),
                    // ETH to DAI: 100 ETH tokens can be converted to N DAI tokens
                    kyber
                        .methods
                        .getExpectedRate(
                            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                            addresses.tokens.dai,
                            AMOUNT_ETH_WEI
                        )
                        .call(),
                ]);

                // Normalize Kyber prices
                const kyberRates = {
                    buy: parseFloat(1 / (kyberResults[0].expectedRate / (10 ** 18))),
                    sell: parseFloat(kyberResults[1].expectedRate / (10 ** 18))
                };
                console.log('Kyber ETH/DAI:');
                console.log(kyberRates);

                const uniswapResults = await Promise.all([
                    daiWeth.getOutputAmount(new TokenAmount(dai, AMOUNT_DAI_WEI)),
                    daiWeth.getOutputAmount(new TokenAmount(weth, AMOUNT_ETH_WEI)),
                ]);

                const uniswapRates = {
                    buy: parseFloat(AMOUNT_DAI_WEI / (uniswapResults[0][0].toExact() * 10 ** 18)),
                    sell: parseFloat(uniswapResults[1][0].toExact() / AMOUNT_ETH)
                };

                console.log('Uniswap ETH/DAI');
                console.log(uniswapRates);

                const gasPrice = await web3.eth.getGasPrice();
                const txCost = 200000 * parseInt(gasPrice);
                const currentEthPrice = (uniswapRates.buy + uniswapRates.sell) / 2;

                const profit1 = (parseInt(AMOUNT_ETH_WEI) / (10 ** 18)) * (uniswapRates.sell - kyberRates.buy) - (txCost / 10 ** 18) * currentEthPrice;
                const profit2 = (parseInt(AMOUNT_ETH_WEI) / (10 ** 18)) * (kyberRates.sell - uniswapRates.buy) - (txCost / 10 ** 18) * currentEthPrice;
                
                console.log('profit1:', profit1, 'profit2:', profit2, 'tx cost:',(txCost / 10 ** 18) * currentEthPrice, 'currentEthPrice:', currentEthPrice)
                if (profit1 > 0) {
                    console.log('ARB opportunity found!');
                    console.log(`Buy ETH on Kyber at ${kyberRates.buy} DAI`);
                    console.log(`Sell ETH on Uniswap at ${uniswapRates.sell} DAI`);
                    console.log(`Expected profit: ${profit1} DAI`);
                } else if (profit2 > 0) {
                    console.log('ARB opportunity found!');
                    console.log(`Buy ETH on Uniswap at ${uniswapRates.buy} DAI`);
                    console.log(`Sell ETH on Kyber at ${kyberRates.sell} DAI`);
                    console.log(`Expected profit: ${profit2} DAI`);
                }
            })
            .on('error', err => {
                console.log(err);
            });

    } catch (err) {
        console.log('errorin:', err)
    };
}

init();
