## Installation
```bash
git clone git@github.com:dorothy-zbornak/pull-0x-exchange-calls
cd pull-0x-exchange-calls
yarn
```
Place your Google credentials file in `/credentials.json`

## Running
```bash
yarn start
    # First block to scan. Defaults to 0.
    [--start-block BLOCK_NUMBER]
    # Last block to scan. Defaults to latest.
    [--end-block BLOCK_NUMBER]
    # Minimum block time. Can be a date/time, or a natural language phrase (e.g., "yesterday").
    [--since TIME_PHRASE]
    # Maximum block time. Can be a date/time, or a natural language phrase (e.g., "now").
    [--until TIME_PHRASE]
    # Direct caller of Exchange contract. Defaults to any. Repeatable.
    [--caller ADDRESS]
    # Type of call. Defaults to all. Repeatable.
    [--call-type call | staticall | callcode | delegatecall]
    # Whether to also capture constant function calls.
    [--include-constant-functions]
    # What exchange function call to capture (defaults to just mutators). Repeatable.
    # Use '!FUNCTION_NAME' to exclude a function.
    [--function FUNCTION_NAME]
    # Address of the contract being called. Defaults to v2 and v2.1 Exchange addresses. Repeatable.
    [--callee ADDRESS]
    # ABI file of the contract being called. Defaults to the Exchange ABI. Repeatable.
    [--callee-abi PATH]
    # The status of the transaction (0 for failure, 1 for success). Defaults to either. Repeatable.
    [--status 0 | 1]
    # Maximum number of results to return. Defaults to unlimited.
    [--limit NUMBER]
    # Whether to pretty-print the output.
    [--pretty]
    # File to write output JSON to. Will print to terminal otherwise.
    [--output FILE]
```

## Sample Output
```json
{
    "transactionHash": "0xed8718d73676b2d01d3c75c9035c94c2d7efe2904ccf55a11ab2015b945991d9",
    "blockNumber": 8215306,
    "traceAddress": "0,4,0",
    "functionName": "getOrderInfo",
    "fromAddress": "0x9317e25590aaa62be015aff026702f3b960131a7",
    "toAddress": "0x1e0447b19bb6ecfdae1e4ae1694b0c3659614e4e",
    "callerAddress": "0x0122676358aee287246b2a84377c8ab664d013cb",
    "calleeAddress": "0x080bf510fcbf18b91105470639e9561022937712",
    "callData": "0xc75e0a810000000000000000000000000000000000000000000000000000000000000020000000000000000000000000ea58392c30bb65355d555f772f6a5c69da564e610000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a258b39954cef5cb142fd567a46cddb31a670124000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000032d07979383d2bf0000000000000000000000000000000000000000000000000000000000037e11d60000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005d393bd50000000000000000000000000000000000000000000000000000016c226b6520000000000000000000000000000000000000000000000000000000000000018000000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000024f47261b000000000000000000000000089d24a6b4ccb1b6faa2625fe562bdd9a23260359000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000024f47261b0000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000",
    "callOutput": "0x0000000000000000000000000000000000000000000000000000000000000003d8304a816965663c30d160529e5055b11c6fb10581760c7d92ed9cece1631a5800000000000000000000000000000000000000000000000000000002e9a7795d",
    "value": "0",
    "status": 1,
    "error": null
}
...
```
