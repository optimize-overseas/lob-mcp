/**
 * A refused tool-input union says what to change.
 *
 * zod 4 reports a union that refused its input as a bare "Invalid input", and
 * the MCP SDK prints only that and its path, so a model that sent `to: {}`
 * could not tell that address_line1 was missing. `unionError` names the
 * nearest option's refusal, or what the union takes. These tests pin the
 * wording and prove the message is all that changes: what the union accepts,
 * and its JSON schema, are the same as without it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  ADDRESS_REF_TAKES,
  addressRefSchema,
  inlineAddressSchema,
  unionError,
} from "../../src/schemas/common.js";

const messages = (schema: z.ZodType, input: unknown): string[] => {
  const r = schema.safeParse(input);
  assert.equal(r.success, false);
  return r.error!.issues.map((i) => i.message);
};

test("an address object missing a required field names the field", () => {
  assert.deepEqual(messages(addressRefSchema, {}), [
    "address_line1: Invalid input: expected string, received undefined",
  ]);
  assert.deepEqual(messages(addressRefSchema, { address_line1: 5, email: "nope" }), [
    "address_line1: Invalid input: expected string, received number; email: Invalid email address",
  ]);
});

test("an input of neither option's type says what the union takes and what it got", () => {
  for (const [input, got] of [[12345, "number"], [null, "null"], [[], "array"], [undefined, "undefined"]] as const) {
    assert.deepEqual(messages(addressRefSchema, input), [
      `Invalid input: expected ${ADDRESS_REF_TAKES}, received ${got}`,
    ]);
  }
});

test("a refusal by one option alone passes through unchanged", () => {
  assert.deepEqual(messages(addressRefSchema, "123 Example St"), [
    "Invalid string: must match pattern /^adr_/",
  ]);
  assert.deepEqual(messages(addressRefSchema, { address_line1: "x", address_country: "USA" }), [
    "Too big: expected string to have exactly 2 characters",
  ]);
});

test("what the union accepts is unchanged", () => {
  assert.equal(addressRefSchema.parse("adr_0000000000"), "adr_0000000000");
  assert.deepEqual(addressRefSchema.parse({ address_line1: "123 Example St", unknown_key: 1 }), {
    address_line1: "123 Example St",
  });
});

test("the error param leaves the JSON schema as it was", () => {
  const plain = z.union([z.string().regex(/^adr_/).describe("Existing Lob address ID."), inlineAddressSchema]);
  const withError = z.union([z.string().regex(/^adr_/).describe("Existing Lob address ID."), inlineAddressSchema], {
    error: unionError(ADDRESS_REF_TAKES),
  });
  assert.deepEqual(z.toJSONSchema(withError), z.toJSONSchema(plain));
});
