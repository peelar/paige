import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

export default defineEval({
  description: "Paige answers a basic conversational message without tools",
  tags: ["smoke"],
  timeoutMs: 180_000,
  async test(t) {
    await t.send("Hello Paige. Reply with one short, friendly sentence.");
    t.succeeded();
    t.usedNoTools();
    t.check(
      t.reply,
      satisfies(
        (reply) => typeof reply === "string" && reply.trim().length > 0,
        "Paige returns a non-empty reply",
      ),
    );
  },
});
