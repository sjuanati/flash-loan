require('dotenv').config();
const Web3 = require('web3');
const { ChainId, Token, TokenAmount, Pair, Fetcher } = require('@uniswap/sdk');
const abis = require('./abis');
const { mainnet: addresses } = require('./addresses');

const web3 = new Web3(
    new Web3.providers.WebsocketProvider(process.env.INFURA_URL)
);

const kyber = new web3.eth.Contract(
    abis.kyber.kyberNetworkProxy,
    addresses.kyber.kyberNetworkProxy
);

const AMOUNT_ETH = 100; // balance between too low to make profit vs. too high to make slipage
const RECENT_ETH_PRICE = 230;
const AMOUNT_ETH_WEI = web3.utils.toWei(AMOUNT_ETH.toString());
const AMOUNT_DAI_WEI = web3.utils.toWei((AMOUNT_ETH * RECENT_ETH_PRICE).toString());


const init = async () => {

    try {
        const [dai, weth] = await Promise.all(// Uniswaps trades with WETH, but not ETH
            [addresses.tokens.dai, addresses.tokens.weth].map(tokenAddress => (
                // Token.fetchData(
                //     ChainId.MAINNET,
                //     tokenAddress
                // )
                new Token(
                    ChainId.MAINNET,
                    tokenAddress,
                    18
                )
            ))
        );

        // const daiWeth = await Pair.fetchData(
        //     dai,
        //     weth
        // );
        const daiWeth = await Fetcher.fetchPairData(
            dai,
            weth
        );
        console.log('daiWeth:', daiWeth);


        web3.eth.subscribe('newBlockHeaders')
            .on('data', async block => {
                console.log(`New block received. Block # ${block.number}`);
                const kyberResults = await Promise.all([
                    kyber
                        .methods
                        .getExpectedRate(
                            addresses.tokens.dai,
                            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                            AMOUNT_DAI_WEI // Amount of DAI we want to sell
                        )
                        .call(), //Not tx, but read-only operation, so no cost
                    kyber
                        .methods
                        .getExpectedRate(
                            '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                            addresses.tokens.dai,
                            AMOUNT_ETH_WEI
                        )
                        .call(),
                ]);
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
                console.log(uniswapResults);
            })
            .on('error', err => {
                console.log(err);
            });

    } catch (err) {
        console.log('errorin:', err)
    };
}

init();
