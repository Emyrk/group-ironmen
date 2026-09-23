import { createCalculatorRequest, parseCalculatorResponse } from "./calculator-protocol";

export class CalculatorClient {
  constructor(transport) {
    this.transport = transport;
    this.nextRequestId = 0;
    this.latestRequestId = -1;
  }

  async calculate(input) {
    const requestId = this.nextRequestId++;
    this.latestRequestId = requestId;
    const request = createCalculatorRequest({ ...input, requestId });
    const response = await this.transport(request);
    if (requestId !== this.latestRequestId) return null;
    return parseCalculatorResponse(response, requestId);
  }
}

export function createHttpCalculatorTransport(url, fetchImplementation = fetch) {
  return async (request) => {
    const response = await fetchImplementation(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`Calculator request failed with status ${response.status}`);
    return response.json();
  };
}
