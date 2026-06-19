import { enclaveSimulator, LedgerEntry } from "../sdk-wrapper/enclave-sim";

export function readAuditLedger(): LedgerEntry[] {
    return enclaveSimulator.getLedger();
}
