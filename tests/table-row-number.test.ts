import assert from "node:assert/strict"
import test from "node:test"

import { tableRowNumber } from "../lib/table-row-number"

test("numbers table rows from one", () => {
  assert.equal(tableRowNumber(0), 1)
  assert.equal(tableRowNumber(14), 15)
})
