import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db/client";
import { findUserByEmail } from "@/lib/db/users";

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)("auth identity mapping", () => {
  afterAll(async () => {
    if (hasDatabase) {
      await getDb().end({ timeout: 5 });
    }
  });

  it("resolves a verified email case-insensitively to one employee row", async () => {
    const user = await findUserByEmail("MAYA.CHEN@LEAVETRACK.DEMO");

    expect(user).not.toBeNull();
    expect(user?.email).toBe("maya.chen@leavetrack.demo");
    expect(user?.role).toBe("employee");
  });

  it("returns null for a verified email with no employee row", async () => {
    await expect(findUserByEmail("new.hire@leavetrack.demo")).resolves.toBeNull();
  });

  it("has the lower(email) unique index the mapping relies on", async () => {
    const rows = await getDb()<{ indexname: string }[]>`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'users'
        and indexname = 'users_email_lower_unique'
    `;

    expect(rows).toHaveLength(1);
  });
});
