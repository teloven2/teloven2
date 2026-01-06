export type OrderStatus =
  | "CREATED"
  | "PAID_IN_CUSTODY"
  | "DELIVERED_MARKED"
  | "CONFIRMED_BY_BUYER"
  | "PAYOUT_INITIATED"
  | "PAID_OUT"
  | "DISPUTE_OPENED"
  | "CANCELLED";

export type ListingType = "product" | "service";
