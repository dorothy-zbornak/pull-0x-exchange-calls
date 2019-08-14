import { getContractAddressesForNetworkOrThrow as getV2_1ContractAddresses } from '@0x/contract-addresses';
import { getContractAddressesForNetworkOrThrow as getV2_0ContractAddresses } from '@0x/contract-addresses-v2';
import { Exchange as ExchangeArtifact } from '@0x/contract-artifacts';
import { AbiEncoder, BigNumber } from '@0x/utils';
import { BigQuery } from '@google-cloud/bigquery';
import { ContractAbi, ContractArtifact, MethodAbi } from 'ethereum-types';
import * as chrono from  'chrono-node';
import * as fs from 'mz/fs';
import * as path from 'path';
import * as R from 'ramda';
import * as yargs from 'yargs';

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
    call_type: string;
    value: {toString(): string};
    status: number;
    error: string;
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
    // The decoded function name.
    functionName: string;
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
    // The call type.
    callType: string;
    // Ether sent along with the call, in wei.
    value: BigNumber;
    // Either 1 (success) or 0 (failure).
    status: number;
    // Error message if this call reverted.
    error?: string;
}

interface ContractFunctionNamesBySelector {
    [selector: string]: string;
}

enum CallType {
    Call = 'call',
    StaticCall = 'staticcall',
    Callcode = 'callcode',
    DelegateCall = 'delegatecall',
}

interface FetchOpts {
    calleeAddresses: string[];
    callTypes: CallType[];
    startBlock?: number;
    endBlock?: number;
    since?: Date;
    until?: Date;
    callerAddresses?: string[];
    statusCodes?: number[];
    limit?: number;
}

const ARGV = yargs
    .number('startBlock')
    .number('endBlock')
    .number('limit')
    .boolean('includeConstantFunctions')
    .boolean('pretty')
    .string('output')
    .string('credentials')
    .string('since')
    .string('until')
    .array('calleeAbi')
    .array('function')
    .array('status')
    .array('caller')
    .array('callType')
    .array('callee')
    .argv;

// The network ID the Exchange contract is deployed on.
const NETWORK_ID = 1;
const START_BLOCK: number | undefined = ARGV.startBlock as number;
const END_BLOCK: number | undefined = ARGV.endBlock as number;
const SINCE: Date | undefined = chrono.parseDate(ARGV.since as string) || undefined;
const UNTIL: Date | undefined = chrono.parseDate(ARGV.until as string) || undefined;
const CALLERS: string[] = ARGV.caller as string[] || [];
const CALLEES: string[] = ARGV.callee as string[] || [];
const CALLEE_ABIS: string[] = ARGV.calleeAbi as string[] || [];
const CALL_TYPES: CallType[] = ARGV.callType as CallType[] || [];
const STATUS_CODES: number[] = ARGV.status as number[] || [];
const LIMIT: number | undefined = ARGV.limit;
const OUTPUT_FILE: string | undefined = ARGV.output;
const CREDENTIALS_FILE: string | undefined = ARGV.credentials;
const PRETTIFY: boolean = ARGV.pretty || false;
const INCLUDE_CONSTANT_FUNCTIONS: boolean = ARGV.includeConstantFunctions || false;
const CONTRACT_FUNCTIONS: string[] = ARGV.function as string[] || [];

(async () => {
    const callees = CALLEES.length > 0 ?
        CALLEES :
        [
            getV2_0ContractAddresses(NETWORK_ID).exchange,
            getV2_1ContractAddresses(NETWORK_ID).exchange,
        ];
    const abis: Array<ContractAbi | ContractArtifact> =
        CALLEE_ABIS.length == 0 ?
        [ ExchangeArtifact ] :
        CALLEE_ABIS.map(file => require(path.resolve(file))) as any;
    const fns = R.mergeAll(abis.map(
        abi => getContractFunctions(
            abi,
            CONTRACT_FUNCTIONS,
            INCLUDE_CONSTANT_FUNCTIONS,
        )),
    );
    if (Object.keys(fns).length == 0) {
        throw new Error('No function calls to capture!');
    }
    console.info(`Fetching calls to ${callees} functions: ${Object.values(fns).sort().join(', ')}...`);
    const results = parseBigTableQueryResults(
        await fetchTraces(
            {
                calleeAddresses: callees,
                callerAddresses: CALLERS,
                callTypes: CALL_TYPES,
                startBlock: START_BLOCK,
                endBlock: END_BLOCK,
                since: SINCE,
                until: UNTIL,
                statusCodes: STATUS_CODES,
                limit: LIMIT,
            }
        ),
        fns,
    );
    await writeOutput(results);
})();

async function writeOutput(results: ContractCall[]) {
    const json = PRETTIFY ?
        results.map(r => JSON.stringify(r, null, '  ')) :
        results.map(r => JSON.stringify(r));
    if (OUTPUT_FILE) {
        await fs.writeFile(OUTPUT_FILE, json.join('\n'), 'utf-8');
    } else {
        console.log(json.join('\n'));
    }
}

// Fetches BigQuery call trace results.
async function fetchTraces(
    opts: FetchOpts,
): Promise<BigQueryContractCallTracesResp[]> {
    const query = createBigTableQuery(opts);
    const bqOpts = {} as any;
    if (CREDENTIALS_FILE) {
        const credentials =  JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
        Object.assign(bqOpts, {
            credentials: {
                client_email: credentials.client_email,
                private_key: credentials.private_key,
            },
            projectId: credentials.project_id || credentials.projectId,
        });
    }
    const bqClient = new BigQuery(bqOpts);
    const [ job ] = await bqClient.createQueryJob({ query, location: 'US' });
    const [ rows ] = await job.getQueryResults();
    return rows;
}

// Create a big table query for call trace results.
function createBigTableQuery(
    opts: FetchOpts,
): string {
    const calleeAddresses = opts.calleeAddresses.map(s => `'${s.toLowerCase()}'`).join(',');
    const callerAddresses = (opts.callerAddresses || []).map(s => `'${s.toLowerCase()}'`).join(',');
    const callTypes = (opts.callTypes || []).map(s => `'${s}'`).join(',');
    const statusCodes = (opts.statusCodes || []).join(',');
    return `
        SELECT
            c.transaction_hash,
            c.block_number,
            c.block_timestamp,
            c.trace_address,
            t.from_address,
            t.to_address,
            c.from_address AS caller_address,
            c.to_address AS callee_address,
            c.input AS call_data,
            c.output AS call_output,
            c.call_type,
            c.value,
            c.status,
            c.error
        FROM \`bigquery-public-data.crypto_ethereum.traces\` c
        LEFT JOIN \`bigquery-public-data.crypto_ethereum.transactions\` t ON c.transaction_hash = t.hash
        WHERE
                -- Must not be an internal/delegated call
                c.from_address <> c.to_address
            AND
                -- Must be to a callee address
                lower(c.to_address) IN (${calleeAddresses})
            AND
                -- Must be >= since
                ${opts.since !== undefined ? `c.block_timestamp >= TIMESTAMP_MILLIS(${opts.since.getTime()})` : `1=1`}
            AND
                -- Must be <= until
                ${opts.until !== undefined ? `c.block_timestamp <= TIMESTAMP_MILLIS(${opts.until.getTime()})` : `1=1`}
            AND
                -- Must be >= startBlock
                ${opts.startBlock !== undefined ? `c.block_number >= ${opts.startBlock}` : `1=1`}
            AND
                -- Must be < endBlock
                ${opts.endBlock !== undefined ? `c.block_number < ${opts.endBlock}` : `1=1`}
            AND
                -- Must be a call type we want.
                ${callTypes.length > 0 ?  `c.call_type IN (${callTypes})` : `1=1`}
            AND
                -- Must have a status code we want.
                ${statusCodes.length > 0 ?  `c.status IN (${statusCodes})` : `1=1`}
            AND
                -- Must be from a caller address
                ${callerAddresses.length > 0 ? `c.from_address IN (${callerAddresses})` : `1=1`}
        ORDER BY c.block_number ASC
        ${opts.limit ? `LIMIT ${opts.limit}` : ``}
    `;
}

function getContractFunctions(
    contractAbi: ContractAbi | ContractArtifact,
    names: string[] = [],
    includeConstants: boolean,
): ContractFunctionNamesBySelector {
    const _contractAbi = isContractArtifact(contractAbi) ?
        contractAbi.compilerOutput.abi :
        contractAbi;
    const ignoredNames = names.filter(n => n.startsWith('!')).map(n => n.substr(1));
    const wantedNames = names.filter(n => !n.startsWith('!'));
    const results = {} as ContractFunctionNamesBySelector;
    // Find all non-constant Exchange contract functions.
    for (const abi of _contractAbi as MethodAbi[]) {
        if (abi.type === 'function') {
            const isMutator = abi.stateMutability === undefined ||
                !R.includes(abi.stateMutability, ['view', 'pure']);
            if (isMutator || includeConstants) {
                if (!R.includes(abi.name, ignoredNames)) {
                    if (wantedNames.length == 0 || R.includes(abi.name, wantedNames)) {
                        results[new AbiEncoder.Method(abi).getSelector()] = abi.name;
                    }
                }
            }
        }
    }
    return results;
}

function isContractArtifact(abi: ContractAbi | ContractArtifact): abi is ContractArtifact {
    return 'compilerOutput' in abi;
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
                functionName: fns[selector],
                fromAddress: bqResult.from_address,
                toAddress: bqResult.to_address,
                callerAddress: bqResult.caller_address,
                calleeAddress: bqResult.callee_address,
                callData: bqResult.call_data,
                callOutput: bqResult.call_output,
                callType: bqResult.call_type,
                value: new BigNumber(bqResult.value.toString()),
                status: bqResult.status,
                error: bqResult.error,
            });
        }
    }
    return results;
}

function getSelectorFromCallData(callData: string) {
    return callData.slice(0, 10);
}
