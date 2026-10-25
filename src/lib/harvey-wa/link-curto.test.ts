import { test } from "node:test";
import assert from "node:assert/strict";
import { linkCurtoDoCheckout } from "./cerebro";

test("o link do sinal é curto: /pay/<referência da reserva>", () => {
  const antes = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://app.getfixfy.com/";
  assert.equal(linkCurtoDoCheckout("FX-G4N4UM"), "https://app.getfixfy.com/pay/FX-G4N4UM");
  assert.ok(linkCurtoDoCheckout("FX-G4N4UM").length < 45);
  process.env.NEXT_PUBLIC_APP_URL = antes;
});
