/** Errors the SDK raises, so callers can branch on type rather than message text. */

export class UpkeepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpkeepError';
  }
}

/** The client was created without deployed contract addresses. */
export class ProtocolNotConfiguredError extends UpkeepError {
  constructor(missing: string[] = []) {
    super(
      missing.length > 0
        ? `upKEEP contract addresses are not configured: ${missing.join(', ')}`
        : 'upKEEP contract addresses are not configured for this network.',
    );
    this.name = 'ProtocolNotConfiguredError';
  }
}

/** A write was attempted on a read-only client. */
export class WalletRequiredError extends UpkeepError {
  constructor(operation: string) {
    super(
      `${operation} needs a wallet. Create the client with a walletClient and account to send transactions.`,
    );
    this.name = 'WalletRequiredError';
  }
}

/** A condition or action type that V1 does not enable. */
export class UnsupportedTypeError extends UpkeepError {
  constructor(type: string, supported: string[]) {
    super(`"${type}" is not enabled in this version. Supported: ${supported.join(', ')}`);
    this.name = 'UnsupportedTypeError';
  }
}

/** Input that would have produced an invalid or unsafe condition. */
export class ValidationError extends UpkeepError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
