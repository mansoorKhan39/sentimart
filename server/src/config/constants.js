export const MAX_IMAGES_PER_PRODUCT = 5;
export const MAX_FILES_PER_REQUEST = 2; // Vercel limits a request body to about 4.5 MB
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_PRICE = 100_000_000; // minor units (paisa)
export const MAX_STOCK = 100_000;
export const MAX_CART_QTY = 99;

export const SUB_ORDER_STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'];
export const PAYMENT_METHODS = ['COD', 'TEST_CARD']; // TEST_CARD is simulated: no card data is ever accepted or stored
// Seller moves a sub-order forward only. target status -> the status it must be in right now.
export const SELLER_TRANSITIONS = {
  Confirmed: 'Pending',
  Shipped: 'Confirmed',
  Delivered: 'Shipped',
};
// Customer may cancel only before it is shipped (SRS FR-23).
export const CUSTOMER_CANCELLABLE = ['Pending', 'Confirmed'];

// ---------- reviews (Module 4) ----------
export const SENTIMENT_LABELS = ['positive', 'neutral', 'negative'];
export const REVIEW_STATUSES = ['published', 'flagged', 'removed'];
export const REVIEW_TEXT_MIN = 10;
export const REVIEW_TEXT_MAX = 2000;
export const REVIEW_REPLY_MAX = 1000;
export const DUPLICATE_MIN_LENGTH = 20; // very short texts such as "Great product!" are not treated as copies
export const BURST_WINDOW_MS = 10 * 60_000;
export const BURST_MAX = 5; // this many reviews by one author inside the window counts as burst posting
export const RETRY_MIN_AGE_MS = 60_000; // a pending review is retried at most once a minute
export const MAX_ANALYSIS_ATTEMPTS = 5;
export const LAZY_RETRY_TIMEOUT_MS = 1500;

// ---------- seller and admin APIs (Module 5) ----------
export const REPORT_RANGES = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
export const MAX_REPORT_DAYS = 366;
export const HIDDEN_REASONS = ['admin', 'seller_rejected', 'seller_suspended'];
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'];
