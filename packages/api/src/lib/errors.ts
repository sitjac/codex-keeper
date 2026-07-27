export function toErrorPayload(error: unknown): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  if (error instanceof Error) {
    const statusCode = (error as Error & { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && Number.isInteger(statusCode)) {
      return {
        statusCode,
        body: {
          error: statusCode === 409 ? "conflict" : "request_failed",
          message: error.message,
        },
      };
    }

    if (error.message.startsWith("Unknown session:")) {
      return {
        statusCode: 404,
        body: {
          error: "not_found",
          message: error.message,
        },
      };
    }

    return {
      statusCode: 400,
      body: {
        error: "request_failed",
        message: error.message,
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: "internal_error",
      message: "Unknown error",
    },
  };
}
