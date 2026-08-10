import { getAccessToken } from "./auth.js";

const WCL_ENDPOINT = "https://www.warcraftlogs.com/api/v2/client";

export type GraphQlError = {
  message: string;
  path?: (string | number)[];
};

export class WclGraphQlError extends Error {
  errors: GraphQlError[];

  constructor(errors: GraphQlError[]) {
    super(errors.map((e) => e.message).join("; "));
    this.name = "WclGraphQlError";
    this.errors = errors;
  }
}

export async function wclGraphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(WCL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 429) {
    throw new Error("WCL rate limit exceeded (HTTP 429). Try again later.");
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WCL GraphQL HTTP ${response.status}: ${text}`);
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: GraphQlError[];
  };

  if (payload.errors?.length) {
    console.error("[wcl] graphql errors", {
      variables,
      errors: payload.errors,
    });
    throw new WclGraphQlError(payload.errors);
  }

  if (!payload.data) {
    throw new Error("WCL GraphQL returned no data");
  }

  return payload.data;
}
