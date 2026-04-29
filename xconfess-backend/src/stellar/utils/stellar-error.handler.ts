import { BadRequestException } from '@nestjs/common';

// src/stellar/utils/stellar-error.handler.ts
// Centralized error handler for Stellar/Soroban integration

export class StellarTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StellarTimeoutError';
  }
}

export class StellarInvalidSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StellarInvalidSignatureError';
  }
}

export class StellarMalformedTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StellarMalformedTransactionError';
  }
}

export class StellarNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StellarNetworkError';
  }
}

export class SorobanContractError extends BadRequestException {
  constructor(
    message: string,
    contractErrorCode?: number,
    contractErrorDetails?: string,
  ) {
    super({
      message,
      code: 'CONTRACT_EXECUTION_FAILED',
      contractErrorCode,
      contractErrorDetails,
    });
    this.name = 'SorobanContractError';
  }
}

const CONTRACT_FAILURE_INDICATORS = new Set([
  'tx_failed',
  'op_failed',
  'op_inner',
]);

function hasContractFailureIndicators(resultCodes: any): boolean {
  if (!resultCodes) {
    return false;
  }

  if (typeof resultCodes.transaction === 'string') {
    if (CONTRACT_FAILURE_INDICATORS.has(resultCodes.transaction)) {
      return true;
    }
  }

  if (Array.isArray(resultCodes.operations)) {
    return resultCodes.operations.some((code: unknown) =>
      typeof code === 'string' && CONTRACT_FAILURE_INDICATORS.has(code),
    );
  }

  return false;
}

function extractContractErrorCode(error: any): number | undefined {
  const rawMessage = String(error?.message || '');

  if (/panic/i.test(rawMessage)) {
    const match = rawMessage.match(/(\d+)/);
    if (match) {
      const parsed = Number(match[1]);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  const jsonPayloadMatch = rawMessage.match(/\{.*\}$/s);
  if (jsonPayloadMatch) {
    try {
      const payload = JSON.parse(jsonPayloadMatch[0]);
      if (typeof payload === 'object' && payload !== null) {
        const resultCodes = (payload as any).transaction || (payload as any).operations;
        if (typeof payload.error === 'string') {
          const errorMatch = payload.error.match(/(\d+)/);
          if (errorMatch) {
            const parsed = Number(errorMatch[1]);
            if (!Number.isNaN(parsed)) {
              return parsed;
            }
          }
        }
        if (typeof payload.transaction === 'string' && CONTRACT_FAILURE_INDICATORS.has(payload.transaction)) {
          return undefined;
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  return undefined;
}

function extractContractErrorDetails(error: any): string | undefined {
  if (error?.response?.data?.extras?.result_codes) {
    return JSON.stringify(error.response.data.extras.result_codes);
  }

  if (typeof error?.message === 'string') {
    return error.message;
  }

  return undefined;
}

function parseContractFailure(error: any): {
  message: string;
  contractErrorCode?: number;
  contractErrorDetails?: string;
} | undefined {
  const resultCodes = error?.response?.data?.extras?.result_codes;
  const rawMessage = String(error?.message || '');

  if (
    rawMessage.includes('Transaction failed') ||
    hasContractFailureIndicators(resultCodes)
  ) {
    return {
      message: 'Contract execution failed',
      contractErrorCode: extractContractErrorCode(error),
      contractErrorDetails: extractContractErrorDetails(error),
    };
  }

  return undefined;
}

export function handleStellarError(error: any): Error {
  if (error instanceof BadRequestException) {
    return error;
  }

  const errorMsg = String(error?.message || '').toLowerCase();
  if (errorMsg.includes('timeout')) {
    return new StellarTimeoutError('Stellar transaction timed out');
  }
  if (errorMsg.includes('signature') || errorMsg.includes('bad_auth')) {
    return new StellarInvalidSignatureError(
      'Invalid Stellar transaction signature',
    );
  }
  if (errorMsg.includes('tx_bad_seq') || errorMsg.includes('malformed')) {
    return new StellarMalformedTransactionError(
      'Malformed Stellar transaction',
    );
  }

  const contractFailure = parseContractFailure(error);
  if (contractFailure) {
    return new SorobanContractError(
      contractFailure.message,
      contractFailure.contractErrorCode,
      contractFailure.contractErrorDetails,
    );
  }

  if (error.response?.data?.extras?.result_codes) {
    const codes = error.response.data.extras.result_codes;
    const txCode = codes.transaction;

    if (txCode === 'tx_bad_auth') {
      return new StellarInvalidSignatureError(
        'Invalid Stellar transaction signature',
      );
    }
    if (txCode === 'tx_bad_seq' || txCode === 'tx_malformed') {
      return new StellarMalformedTransactionError(
        'Malformed Stellar transaction',
      );
    }

    return new StellarNetworkError(`Stellar error: ${JSON.stringify(codes)}`);
  }

  if (error.response?.data?.detail) {
    return new StellarNetworkError(
      `Stellar error: ${error.response.data.detail}`,
    );
  }

  return new StellarNetworkError(`Stellar error: ${error.message || error}`);
}
