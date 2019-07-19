import { getContractAddressesForNetworkOrThrow } from '@0x/contract-addresses';
import { Exchange as ExchangeArtifact } from '@0x/contract-artifacts';
import { AbiEncoder, BigNumber } from '@0x/utils';
import { BigQuery } from '@google-cloud/bigquery';
import { ContractAbi, MethodAbi } from 'ethereum-types';
import * as R from 'ramda';
import { argv } from 'yargs';

interface BigQueryContractCallTracesResp {
    transaction_hash: string;
    block_number: number;
    trace_address: string;
    from_address: string;
    to_address: string;
    caller_address: string;
    callee_address: string;
    call_data: string;
    call_output: string;
    value: {toString(): string};
    status: number;
}

// Parsed contract call entry.
interface ContractCall {
    // The transaction hash.
    // (PrimaryColumn)
    transactionHash: string;
    // The block number of the transaction.
    // (PrimaryColumn)
    blockNumber: number;
    // Comma separated list of trace address in call tree.
    // (PrimaryColumn)
    traceAddress: string;
    // The address of the sender of the transaction.
    fromAddress: string;
    // The address of the top-level contract that was called.
    toAddress: string;
    // The address of the caller.
    callerAddress: string;
    // The address of the target of the call.
    calleeAddress: string;
    // The ABI-encoded call data.
    callData: string;
    // The ABI-encoded call output.
    callOutput: string | null;
    // Ether sent along with the call, in wei.
    value: BigNumber;
    // Either 1 (success) or 0 (failure).
    status: number;
    // The decoded function name.
    functionName: string;
}

interface ContractFunctionNamesBySelector {
    [selector: string]: string;
}

// The network ID the Exchange contract is deployed on.
const NETWORK_ID = 1;
// The earliest block number to search.
const START_BLOCK = argv.startBlock as number || 8140780;

(async () => {
    const results = parseBigTableQueryResults(
        await fetchTraces(
            START_BLOCK,
            [
                getContractAddressesForNetworkOrThrow(NETWORK_ID).exchange,
            ],
        ),
        getStatefulContractFunctions(ExchangeArtifact.compilerOutput.abi),
    );
    // Print out results
    for (const r of results) {
        if (argv.pretty) {
            console.log(JSON.stringify(r, null, '  '));
        } else {
            console.log(JSON.stringify(r));
        }
    }
})();

// Fetches BigQuery call trace results.
async function fetchTraces(
    fromBlockNumber: number,
    contractAddresses: string[],
): Promise<BigQueryContractCallTracesResp[]> {
    const query = createBigTableQuery(fromBlockNumber, contractAddresses);
    const bqClient = new BigQuery();
    const [ job ] = await bqClient.createQueryJob({ query, location: 'US' });
    const [ rows ] = await job.getQueryResults();
    return rows;
}

// Create a big table query for call trace results.
function createBigTableQuery(
    fromBlockNumber: number,
    contractAddresses: string[],
): string {
    const lowercaseContractAddresses = R.map(
        (s: string) => s.toLowerCase(),
        contractAddresses,
    );
    return `
        SELECT
            c.transaction_hash,
            c.block_number,
            c.trace_address,
            t.from_address,
            t.to_address,
            c.from_address AS caller_address,
            c.to_address AS callee_address,
            c.input AS call_data,
            c.output AS call_output,
            c.value,
            c.status
        FROM \`bigquery-public-data.crypto_ethereum.traces\` c
        LEFT JOIN \`bigquery-public-data.crypto_ethereum.transactions\` t ON c.transaction_hash = t.hash
        WHERE
                c.block_number >= ${fromBlockNumber}
            AND
                /* Must be a stateful transaction */
                c.call_type = 'call'
            AND
                /* Must not be an internal/delegated call */
                c.from_address <> c.to_address
            AND
                lower(c.to_address) in ('${lowercaseContractAddresses.join("','")}')
        ORDER BY c.block_number ASC
    `;
}

function getStatefulContractFunctions(contractAbi: ContractAbi): ContractFunctionNamesBySelector {
    const results = {} as ContractFunctionNamesBySelector;
    // Find all non-constant Exchange contract functions.
    for (const abi of contractAbi as MethodAbi[]) {
        const isMutatorFunction =
            abi.type === 'function' &&
            (
                abi.stateMutability === undefined ||
                !R.includes(abi.stateMutability, ['view', 'pure'])
            );
        if (isMutatorFunction) {
            const abiEncoder = new AbiEncoder.Method(abi);
            results[abiEncoder.getSelector()] = abi.name;
        }
    }
    return results;
}

function parseBigTableQueryResults(
    bqResults: BigQueryContractCallTracesResp[],
    fns: ContractFunctionNamesBySelector,
): ContractCall[] {
    const results = [] as ContractCall[];
    for (const bqResult of bqResults) {
        const selector = getSelectorFromCallData(bqResult.call_data);
        if (selector in fns) {
            results.push({
                transactionHash: bqResult.transaction_hash,
                blockNumber: bqResult.block_number,
                traceAddress: bqResult.trace_address,
                fromAddress: bqResult.from_address,
                toAddress: bqResult.to_address,
                callerAddress: bqResult.caller_address,
                calleeAddress: bqResult.callee_address,
                callData: bqResult.call_data,
                callOutput: bqResult.call_output,
                value: new BigNumber(bqResult.value.toString()),
                status: bqResult.status,
                functionName: fns[selector],
            });
        }
    }
    return results;
}

function getSelectorFromCallData(callData: string) {
    return callData.slice(0, 10);
}
