/** Public Mettal ledger row. Document numbers are not part of this shape. */
export type PublicMettalTransaction = {
  id?: string;
  type?: string;
  status?: string;
  concept?: string;
  amount?: {
    value?: number;
    currency?: string;
    symbol?: string;
  };
  date?: {
    createdAt?: string;
    updatedAt?: string;
  };
  fee?: {
    total?: number;
    currency?: string;
    symbol?: string;
  };
  bank?: {
    account?: string;
    bankName?: string;
  };
  blockchain?: {
    network?: string;
    address?: string;
    transactionHash?: string;
  };
};

export type MettalTransactionPage = {
  rows: PublicMettalTransaction[];
  page: number;
  pages: number;
  total: number;
};

export type ActivityRecord = {
  id: string;
  at: number;
  title: string;
  amountLabel: string;
  detail?: string;
  counterparty?: string;
  counterpartyPrefix?: "a" | "de";
  statusLabel?: string;
};
