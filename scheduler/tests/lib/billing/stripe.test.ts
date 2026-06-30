import { getOrCreateStripeCustomer, isMissingStripeResourceError } from "@/lib/billing/stripe";

import type Stripe from "stripe";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: jest.fn(),
    },
  },
}));

type StripeCustomerClient = NonNullable<Parameters<typeof getOrCreateStripeCustomer>[1]>;
type BillingClient = NonNullable<Parameters<typeof getOrCreateStripeCustomer>[2]>;

function stripeCustomer(id: string): Stripe.Customer {
  return { id, object: "customer", deleted: false } as unknown as Stripe.Customer;
}

function deletedStripeCustomer(id: string): Stripe.DeletedCustomer {
  return { id, object: "customer", deleted: true } as unknown as Stripe.DeletedCustomer;
}

function stripeResponse<T extends object>(value: T): Stripe.Response<T> {
  return {
    ...value,
    lastResponse: {
      headers: {},
      requestId: "req_test",
      statusCode: 200,
    },
  };
}

function missingStripeCustomerError(): Stripe.errors.StripeInvalidRequestError {
  return {
    type: "StripeInvalidRequestError",
    message: "No such customer: 'cus_stale'",
    code: "resource_missing",
    raw: {
      type: "invalid_request_error",
      code: "resource_missing",
      message: "No such customer: 'cus_stale'",
      param: "customer",
    },
    param: "customer",
  } as unknown as Stripe.errors.StripeInvalidRequestError;
}

function missingStripeCustomerErrorWithParam(param?: string): Stripe.errors.StripeInvalidRequestError {
  return {
    type: "StripeInvalidRequestError",
    message: "No such customer: 'cus_stale'",
    code: "resource_missing",
    raw: {
      type: "invalid_request_error",
      code: "resource_missing",
      message: "No such customer: 'cus_stale'",
      ...(param ? { param } : {}),
    },
    ...(param ? { param } : {}),
  } as unknown as Stripe.errors.StripeInvalidRequestError;
}

function missingStripeSubscriptionError(): Stripe.errors.StripeInvalidRequestError {
  return {
    type: "StripeInvalidRequestError",
    message: "No such subscription: 'sub_stale'",
    code: "resource_missing",
    raw: {
      type: "invalid_request_error",
      code: "resource_missing",
      message: "No such subscription: 'sub_stale'",
    },
  } as unknown as Stripe.errors.StripeInvalidRequestError;
}

function mockCustomers(): StripeCustomerClient {
  return {
    create: jest.fn().mockResolvedValue(stripeCustomer("cus_new")),
    retrieve: jest.fn(),
  } as unknown as StripeCustomerClient;
}

function mockClient(): BillingClient {
  return {
    user: {
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as BillingClient;
}

const user = {
  id: "user-1",
  email: "owner@example.com",
  name: "Owner",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("isMissingStripeResourceError", () => {
  it("detects Stripe resource_missing errors for the requested resource", () => {
    expect(isMissingStripeResourceError(missingStripeCustomerError(), "customer")).toBe(true);
    expect(isMissingStripeResourceError(missingStripeCustomerErrorWithParam(), "customer")).toBe(true);
    expect(isMissingStripeResourceError(missingStripeCustomerErrorWithParam("id"), "customer")).toBe(true);
    expect(isMissingStripeResourceError(missingStripeCustomerError(), "subscription")).toBe(false);
    expect(isMissingStripeResourceError(missingStripeSubscriptionError(), "customer")).toBe(false);
    expect(isMissingStripeResourceError(new Error("No such customer"), "customer")).toBe(false);
  });
});

describe("getOrCreateStripeCustomer", () => {
  it("returns an existing Stripe customer when the stored ID is valid", async () => {
    const customers = mockCustomers();
    const client = mockClient();
    jest.mocked(customers.retrieve).mockResolvedValue(stripeResponse(stripeCustomer("cus_existing")));

    const customerId = await getOrCreateStripeCustomer(
      { ...user, stripeCustomerId: "cus_existing" },
      customers,
      client,
    );

    expect(customerId).toBe("cus_existing");
    expect(customers.retrieve).toHaveBeenCalledWith("cus_existing");
    expect(customers.create).not.toHaveBeenCalled();
    expect(client.user.update).not.toHaveBeenCalled();
  });

  it("creates and stores a Stripe customer when the user has no stored customer ID", async () => {
    const customers = mockCustomers();
    const client = mockClient();

    const customerId = await getOrCreateStripeCustomer(user, customers, client);

    expect(customerId).toBe("cus_new");
    expect(customers.retrieve).not.toHaveBeenCalled();
    expect(customers.create).toHaveBeenCalledWith({
      email: "owner@example.com",
      name: "Owner",
      metadata: {
        userId: "user-1",
      },
    });
    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { stripeCustomerId: "cus_new" },
    });
  });

  it("replaces a stale stored customer ID when Stripe cannot find it", async () => {
    const customers = mockCustomers();
    const client = mockClient();
    jest.mocked(customers.retrieve).mockRejectedValue(missingStripeCustomerError());

    const customerId = await getOrCreateStripeCustomer({ ...user, stripeCustomerId: "cus_stale" }, customers, client);

    expect(customerId).toBe("cus_new");
    expect(customers.retrieve).toHaveBeenCalledWith("cus_stale");
    expect(customers.create).toHaveBeenCalledTimes(1);
    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { stripeCustomerId: "cus_new" },
    });
  });

  it("replaces a stored customer ID when Stripe reports a deleted customer", async () => {
    const customers = mockCustomers();
    const client = mockClient();
    jest.mocked(customers.retrieve).mockResolvedValue(stripeResponse(deletedStripeCustomer("cus_deleted")));

    const customerId = await getOrCreateStripeCustomer({ ...user, stripeCustomerId: "cus_deleted" }, customers, client);

    expect(customerId).toBe("cus_new");
    expect(customers.create).toHaveBeenCalledTimes(1);
    expect(client.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { stripeCustomerId: "cus_new" },
    });
  });

  it("does not hide non-recoverable Stripe retrieval errors", async () => {
    const customers = mockCustomers();
    const client = mockClient();
    const error = new Error("Stripe is unavailable");
    jest.mocked(customers.retrieve).mockRejectedValue(error);

    await expect(
      getOrCreateStripeCustomer({ ...user, stripeCustomerId: "cus_existing" }, customers, client),
    ).rejects.toBe(error);
    expect(customers.create).not.toHaveBeenCalled();
    expect(client.user.update).not.toHaveBeenCalled();
  });
});
