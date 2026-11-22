import rateLimit from 'express-rate-limit';

export const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please slow down and try again shortly.',
    code: 'RATE_LIMITED',
  },
});

export const financialMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many financial requests. Please wait before trying again.',
    code: 'RATE_LIMITED',
  },
});

export const adminActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Admin rate limit exceeded. Please retry in a moment.',
    code: 'RATE_LIMITED',
  },
});
