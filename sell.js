const { Metaplex } = require('@metaplex-foundation/js');
const { NATIVE_MINT, getMint, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const { Connection, clusterApiUrl, Keypair, PublicKey, LAMPORTS_PER_SOL, VersionedTransaction } = require('@solana/web3.js');
const {
    MAINNET_PROGRAM_ID,
    DEVNET_PROGRAM_ID,
    SPL_ACCOUNT_LAYOUT,
    Liquidity,
    Token,
    poolKeys2JsonInfo,
    TokenAmount,
    Percent,
    jsonInfo2PoolKeys,
} = require("@raydium-io/raydium-sdk");
const { Market, MARKET_STATE_LAYOUT_V3 } = require("@project-serum/serum");
const axios = require("axios");
const bs58 = require('bs58')
require('dotenv').config()

const RPC_URL = process.env.RPC_URL ? process.env.RPC_URL : clusterApiUrl("mainnet-beta");
const connection = new Connection(RPC_URL, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60 * 1000,
});

const JITO_TIP = parseFloat(process.env.JITO_TIP) || 0.001;
const JITO_TIMEOUT = parseInt(process.env.JITO_TIMEOUT) || 60000
const JITO_MAINNET_URL = process.env.JITO_MAINNET_URL || 'https://amsterdam.mainnet.block-engine.jito.wtf'

const PAYER_SECRET = bs58.decode(process.env.PRIVATE_KEY);
const PAYER = Keypair.fromSecretKey(PAYER_SECRET);
const PAYER_ADDRESS = PAYER.publicKey

const SELL_TOKEN_ADDRESS = process.env.SELL_TOKEN || NATIVE_MINT.toBase58(); // So11111111111111111111111111111111111111112 WSOL MINT ADDRESS
const BUY_TOKEN_ADDRESS = process.env.BUY_TOKEN || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v USDC MINT ADDRESS

const SELL_PRICE = parseFloat(process.env.SELL_PRICE) || 220;
const SELL_POOLED_SOL = parseFloat(process.env.SELL_POOLED_SOL) || 200;
const SELL_AMOUNT = parseFloat(process.env.SELL_AMOUNT) || 0.1;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTokenMetaData(connection, tokenMint) {
    let retries = 3;
    while (retries > 0) {
        try {
            retries--;
            const metaplex = Metaplex.make(connection);
            const metadataAccount = metaplex
                .nfts()
                .pdas()
                .metadata({ mint: tokenMint });

            const metadataAccountInfo = await connection.getAccountInfo(metadataAccount);
            if (metadataAccountInfo) {
                let token = await metaplex.nfts().findByMint({ mintAddress: tokenMint });
                tokenName = token.name;
                tokenSymbol = token.symbol;
                token.mintAddress = tokenMint.toString();
                return token
            }
        } catch (error) {

        }

    }

    return null;

}


const checkPumpFunToken = async (tokenMint) => {
    const pumpTokenAuthority = 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM';
    const metadata = await getTokenMetaData(connection, new PublicKey(tokenMint));
    return metadata.updateAuthorityAddress.toString() == pumpTokenAuthority ? true : false;
}

const getPoolInfo = async (sellMint, buyMint) => {

    if (!sellMint || !buyMint) {
        console.log("Invalid token address");
        return null;
    }

    const token = sellMint == NATIVE_MINT.toBase58() ? buyMint : sellMint;

    const isPumpToken = await checkPumpFunToken(token);

    try {

        const mintInfo = await getMint(connection, new PublicKey(token));
        const baseToken = isPumpToken ? new Token(
            TOKEN_PROGRAM_ID,
            "So11111111111111111111111111111111111111112",
            9,
            "WSOL",
            "WSOL"
        ) : new Token(TOKEN_PROGRAM_ID, token, mintInfo.decimals);
        const quoteToken = isPumpToken ? new Token(TOKEN_PROGRAM_ID, token, mintInfo.decimals) : new Token(
            TOKEN_PROGRAM_ID,
            "So11111111111111111111111111111111111111112",
            9,
            "WSOL",
            "WSOL"
        );

        const PROGRAMIDS = process.env.DEVNET_MODE === "true" ? DEVNET_PROGRAM_ID : MAINNET_PROGRAM_ID;
        const marketAccounts = await Market.findAccountsByMints(
            connection,
            baseToken.mint,
            quoteToken.mint,
            PROGRAMIDS.OPENBOOK_MARKET
        );
        if (marketAccounts.length === 0) {
            console.log("Not found market info");
            return null;
        }

        const marketInfo = MARKET_STATE_LAYOUT_V3.decode(
            marketAccounts[0].accountInfo.data
        );
        let poolKeys = Liquidity.getAssociatedPoolKeys({
            version: 4,
            marketVersion: 3,
            baseMint: baseToken.mint,
            quoteMint: quoteToken.mint,
            baseDecimals: baseToken.decimals,
            quoteDecimals: quoteToken.decimals,
            marketId: marketAccounts[0].publicKey,
            programId: PROGRAMIDS.AmmV4,
            marketProgramId: PROGRAMIDS.OPENBOOK_MARKET,
        });
        poolKeys.marketBaseVault = marketInfo.baseVault;
        poolKeys.marketQuoteVault = marketInfo.quoteVault;
        poolKeys.marketBids = marketInfo.bids;
        poolKeys.marketAsks = marketInfo.asks;
        poolKeys.marketEventQueue = marketInfo.eventQueue;

        const poolInfo = poolKeys2JsonInfo(poolKeys);
        return poolInfo;

    } catch (error) {
        console.log('GetPoolInfo:', error)
    }
    return null
};

const getJitoTipAccount = () => {
    const tipAccounts = [
        "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
        "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
        "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
        "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
        "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
        "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
        "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
        "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
    ];
    // Randomly select one of the tip addresses
    const selectedTipAccount = tipAccounts[Math.floor(Math.random() * tipAccounts.length)];
    return selectedTipAccount;
};

const getJitoTipInstruction = async (keypair) => {

    while (1) {
        try {

            const tipAccount = getJitoTipAccount();

            return SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: new PublicKey(tipAccount),
                lamports: JITO_TIP * LAMPORTS_PER_SOL,
            });

        } catch (error) {
            console.error('Jito Tip Transaction Error', error);
        }
        await sleep(100);
    }

}

const calcAmountOut = async (poolKeys, rawAmountIn, swapInDirection) => {
    try {
        const poolInfo = await Liquidity.fetchInfo({ connection: connection, poolKeys: poolKeys })

        let currencyInMint = poolKeys.baseMint
        let currencyInDecimals = poolInfo.baseDecimals
        let currencyOutMint = poolKeys.quoteMint
        let currencyOutDecimals = poolInfo.quoteDecimals

        if (!swapInDirection) {
            currencyInMint = poolKeys.quoteMint
            currencyInDecimals = poolInfo.quoteDecimals
            currencyOutMint = poolKeys.baseMint
            currencyOutDecimals = poolInfo.baseDecimals
        }

        const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals)
        const amountIn = new TokenAmount(currencyIn, rawAmountIn, false)
        const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals)
        const slippage = new Percent(80, 100) // 20% slippage

        const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } = Liquidity.computeAmountOut({
            poolKeys,
            poolInfo,
            amountIn,
            currencyOut,
            slippage,
        })

        return {
            amountIn,
            amountOut,
            minAmountOut,
            currentPrice,
            executionPrice,
            priceImpact,
            fee,
        }
    } catch (error) {
        console.log('calcAmountOut', error)
    }
}

const getSwapTransaction = async (
    payer,
    toToken,
    amount,
    poolKeys,
    maxLamports = 100000,
    useVersionedTransaction = true,
    fixedSide = 'in',
    useJito = true
) => {

    const directionIn = poolKeys.quoteMint.toString() == toToken
    const { minAmountOut, amountIn } = await calcAmountOut(poolKeys, amount, directionIn)

    const userTokenAccounts = await getOwnerTokenAccounts()
    const swapTransaction = await Liquidity.makeSwapInstructionSimple({
        connection: connection,
        makeTxVersion: useVersionedTransaction ? 0 : 1,
        poolKeys: {
            ...poolKeys,
        },
        userKeys: {
            tokenAccounts: userTokenAccounts,
            owner: payer.publicKey,
        },
        amountIn: amountIn,
        amountOut: minAmountOut,
        fixedSide: fixedSide,
        config: {
            bypassAssociatedCheck: false,
        },
        // computeBudgetConfig: {
        //   microLamports: maxLamports,
        // }
    })

    const recentBlockhashForSwap = await connection.getLatestBlockhash()
    const instructions = swapTransaction.innerTransactions[0].instructions.filter(Boolean)

    if (useJito) {
        instructions.push(await getJitoTipInstruction(payer))
    }

    if (useVersionedTransaction) {
        const versionedTransaction = new VersionedTransaction(
            new TransactionMessage({
                payerKey: payer.publicKey,
                recentBlockhash: recentBlockhashForSwap.blockhash,
                instructions: instructions,
            }).compileToV0Message()
        )

        versionedTransaction.sign([payer])
        return versionedTransaction
    }

    const legacyTransaction = new Transaction({
        blockhash: recentBlockhashForSwap.blockhash,
        lastValidBlockHeight: recentBlockhashForSwap.lastValidBlockHeight,
        feePayer: payer.publicKey,
    })

    legacyTransaction.add(...instructions)

    return legacyTransaction
}

const makeSwapTransaction = async (sell_mint, buy_mint, sell_amount) => {
    let retry = 0;
    while (1) {

        try {

            const quoteResponse = (await axios.get(
                `https://quote-api.jup.ag/v6/quote`,
                {
                    params: {
                        inputMint: sell_mint,
                        outputMint: buy_mint,
                        amount: sell_amount,
                        slippageBps: 50 // Slippage 0.5%
                    }
                }
            )).data;

            const swapResponse = (await axios.post(
                'https://quote-api.jup.ag/v6/swap',
                {
                    quoteResponse: quoteResponse,
                    userPublicKey: PAYER_ADDRESS.toString()
                }
            )).data;

            const swapTransaction = swapResponse.swapTransaction;
            const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
            transaction.sign([PAYER]);

            return transaction;

        } catch (error) {
            console.log(`makeSwapTransaction:`, error);
        }
        await sleep(1000 * 2 ** retry)
        retry++;
        if (retry == 3) return null
    }
}

// Send and Confirm Jito Transaction
const sendBundles = async (transactions, status = "confirmed") => {
    try {
        if (transactions.length === 0) return;
        let bundleIds = [];

        for (let i = 0; i < transactions.length; i++) {
            const rawTransactions = transactions[i].map((item) =>
                bs58.encode(item.serialize())
            );
            // console.log(rawTransactions);
            const { data } = await axios.post(
                JITO_MAINNET_URL + "/api/v1/bundles",
                {
                    jsonrpc: "2.0",
                    id: 1,
                    method: "sendBundle",
                    params: [rawTransactions],
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                    }
                }
            );
            if (data) {
                console.log(data);
                bundleIds = [...bundleIds, data.result];
            }
        }

        console.log("Checking bundle's status...", bundleIds);
        const sentTime = Date.now();
        while (Date.now() - sentTime < JITO_TIMEOUT) {
            try {
                const { data } = await axios.post(
                    JITO_MAINNET_URL + "/api/v1/bundles",
                    {
                        jsonrpc: "2.0",
                        id: 1,
                        method: "getBundleStatuses",
                        params: [bundleIds],
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                        }
                    }
                );

                if (data) {
                    const bundleStatuses = data.result.value;
                    // console.log("Bundle Statuses:", bundleStatuses);
                    let success = true;
                    for (let i = 0; i < bundleIds.length; i++) {
                        const matched = bundleStatuses.find(
                            (item) => item && item.bundle_id === bundleIds[i]
                        );
                        if (!matched || matched.confirmation_status !== status) {
                            success = false;
                            break;
                        } else {
                            console.log("checked", bundleIds[i]);
                        }
                    }

                    if (success) return true;
                }
            } catch (err) {
                // console.log(err);
            }

            await sleep(100);
        }
    } catch (err) {
        console.log(err);
    }
    return false;
};

const getTokenBalance = async (owner, mint) => {

    let tokenAmount = 0;
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
    for (let i = 0; i < accounts?.value?.length; i++) {
        const account = accounts.value[i];
        if (mint == account.account.data.parsed.info.mint) {
            tokenAmount += account.account.data.parsed.info.tokenAmount.amount;
        }
    }
    return tokenAmount

}

const getTokenUiBalance = async (owner, mint) => {

    let tokenAmount = 0;
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
    for (let i = 0; i < accounts?.value?.length; i++) {
        const account = accounts.value[i];
        if (mint == account.account.data.parsed.info.mint) {
            tokenAmount += account.account.data.parsed.info.tokenAmount.uiAmount;
        }
    }
    return tokenAmount

}

const main = async () => {
    try {

        const solBalance = await connection.getBalance(PAYER_ADDRESS);

        let sellAmount = 0
        if (SELL_TOKEN_ADDRESS == NATIVE_MINT.toBase58()) {
            if (solBalance < (SELL_AMOUNT + 0.005) * LAMPORTS_PER_SOL) {
                console.log('Insufficient sol balance to sell')
                return
            }
            sellAmount = SELL_AMOUNT * LAMPORTS_PER_SOL;
        } else {
            const tokenBalance = await getTokenUiBalance(PAYER_ADDRESS, SELL_TOKEN_ADDRESS);
            if (tokenBalance < SELL_AMOUNT) {
                console.log('Insufficient token balance to sell')
                return
            }
            if (solBalance < 0.005 * LAMPORTS_PER_SOL) {
                console.log('Insufficient sol balance for transaction fee')
                return
            }
            sellAmount = await getTokenBalance(PAYER_ADDRESS, SELL_TOKEN_ADDRESS)
        }

        const txn = await makeSwapTransaction(SELL_TOKEN_ADDRESS, BUY_TOKEN_ADDRESS, sellAmount)

        console.log(await connection.simulateTransaction(txn))

        const rawTransaction = txn.serialize()
        const txid = await connection.sendRawTransaction(rawTransaction, {
            skipPreflight: true,
            maxRetries: 2
        });
        await connection.confirmTransaction(txid);

    } catch (e) {
        console.log(e)
    }
}

main()