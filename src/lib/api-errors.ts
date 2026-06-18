import {
  APIError,
  AuthenticationError,
  RateLimitError,
} from "openai";
import { TavilySearchError } from "./web-search-fallback";
import type { ApiErrorCode } from "./types";

export type { ApiErrorCode };

export interface FriendlyApiError {
  message: string;
  code: ApiErrorCode;
  status: number;
}

function isInsufficientQuota(message: string, errorBody: unknown): boolean {
  if (/insufficient_quota|exceeded your current quota|billing/i.test(message)) {
    return true;
  }
  if (errorBody && typeof errorBody === "object") {
    const code = (errorBody as { code?: unknown }).code;
    const type = (errorBody as { type?: unknown }).type;
    return code === "insufficient_quota" || type === "insufficient_quota";
  }
  return false;
}

export function toFriendlyApiError(error: unknown): FriendlyApiError {
  if (error instanceof TavilySearchError) {
    switch (error.code) {
      case "missing_key":
        return {
          code: "tavily_missing_key",
          status: 503,
          message: error.message,
        };
      case "auth":
        return {
          code: "tavily_auth",
          status: 401,
          message:
            "Tavily API key is invalid. Check TAVILY_API_KEY in .env.local and restart the dev server.",
        };
      case "quota":
        return {
          code: "tavily_quota",
          status: 429,
          message:
            "Tavily monthly credits are exhausted. Credits reset on the 1st of each month, or upgrade at app.tavily.com.",
        };
      case "empty_results":
        return {
          code: "tavily_error",
          status: 502,
          message: error.message,
        };
      default:
        return {
          code: "tavily_error",
          status: error.status ?? 502,
          message: error.message,
        };
    }
  }

  if (error instanceof AuthenticationError) {
    return {
      code: "openai_auth",
      status: 401,
      message:
        "OpenAI API key is invalid or expired. Check OPENAI_API_KEY in .env.local and restart the dev server.",
    };
  }

  if (error instanceof RateLimitError) {
    if (isInsufficientQuota(error.message, error.error)) {
      return {
        code: "openai_quota",
        status: 429,
        message:
          "OpenAI credits are exhausted. Add billing or top up at platform.openai.com/account/billing, then try again.",
      };
    }
    return {
      code: "openai_rate_limit",
      status: 429,
      message: "OpenAI rate limit reached. Wait a minute and try again.",
    };
  }

  if (error instanceof APIError) {
    if (error.status === 401) {
      return {
        code: "openai_auth",
        status: 401,
        message:
          "OpenAI API key is invalid or expired. Check OPENAI_API_KEY in .env.local and restart the dev server.",
      };
    }
    if (error.status === 429 && isInsufficientQuota(error.message, error.error)) {
      return {
        code: "openai_quota",
        status: 429,
        message:
          "OpenAI credits are exhausted. Add billing or top up at platform.openai.com/account/billing, then try again.",
      };
    }
    return {
      code: "openai_error",
      status: error.status ?? 500,
      message: `OpenAI request failed: ${error.message}`,
    };
  }

  if (error instanceof Error) {
    if (/OPENAI_API_KEY is not configured/i.test(error.message)) {
      return {
        code: "openai_missing_key",
        status: 503,
        message:
          "OpenAI API key is not configured. Add OPENAI_API_KEY to .env.local and restart the dev server.",
      };
    }
    if (/web search did not return enough content/i.test(error.message)) {
      return {
        code: "web_search_failed",
        status: 502,
        message: error.message,
      };
    }
    if (/blocked automated access and web-search fallback/i.test(error.message)) {
      return {
        code: "tavily_missing_key",
        status: 503,
        message: error.message,
      };
    }
    return {
      code: "scan_failed",
      status: 500,
      message: error.message,
    };
  }

  return {
    code: "scan_failed",
    status: 500,
    message: "Something went wrong. Please try again.",
  };
}
