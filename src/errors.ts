export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export class AccessError extends CliError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 2, options);
    this.name = 'AccessError';
  }
}

export class NetworkError extends CliError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 3, options);
    this.name = 'NetworkError';
  }
}

export class PartialOutputError extends CliError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 4, options);
    this.name = 'PartialOutputError';
  }
}

export class SchemaError extends CliError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 5, options);
    this.name = 'SchemaError';
  }
}
