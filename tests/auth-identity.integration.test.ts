import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db/client";
import { findUserByEmail, resolveUserForIdentity } from "@/lib/db/users";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const MAYA_ID = "a0000000-0000-4000-8000-000000000004";

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

  it("has the partial unique index for linked provider subjects", async () => {
    const rows = await getDb()<{ indexname: string }[]>`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'users'
        and indexname = 'users_auth_subject_unique'
    `;

    expect(rows).toHaveLength(1);
  });

  it("prefers a linked provider subject over the email address", async () => {
    const subject = randomUUID();

    try {
      await getDb()`
        update users
        set auth_subject = ${subject}
        where id = ${MAYA_ID}
      `;

      const resolved = await resolveUserForIdentity({
        subject,
        email: "someone.else@leavetrack.demo",
      });

      expect(resolved?.user.id).toBe(MAYA_ID);
      expect(resolved?.needsSubjectLink).toBe(false);
    } finally {
      await getDb()`
        update users
        set auth_subject = null
        where id = ${MAYA_ID}
      `;
    }
  });

  it("falls back to the email only for an unlinked row and asks to link it", async () => {
    const subject = randomUUID();

    try {
      await getDb()`
        update users
        set auth_subject = null
        where id = ${MAYA_ID}
      `;

      const resolved = await resolveUserForIdentity({
        subject,
        email: "MAYA.CHEN@LEAVETRACK.DEMO",
      });

      expect(resolved?.user.id).toBe(MAYA_ID);
      expect(resolved?.needsSubjectLink).toBe(true);
    } finally {
      await getDb()`
        update users
        set auth_subject = null
        where id = ${MAYA_ID}
      `;
    }
  });

  it("returns the row with isActive false so the session layer can reject it", async () => {
    try {
      await getDb()`
        update users
        set is_active = false,
            deactivated_at = now()
        where id = ${MAYA_ID}
      `;

      const resolved = await resolveUserForIdentity({
        subject: null,
        email: "maya.chen@leavetrack.demo",
      });

      expect(resolved?.user.isActive).toBe(false);
    } finally {
      await getDb()`
        update users
        set is_active = true,
            deactivated_at = null
        where id = ${MAYA_ID}
      `;
    }
  });

  it("does not fall back to email once a row is linked", async () => {
    const linkedSubject = randomUUID();

    try {
      await getDb()`
        update users
        set auth_subject = ${linkedSubject}
        where id = ${MAYA_ID}
      `;

      // A different provider identity that can verify Maya's directory email
      // must not take over the linked row.
      const resolved = await resolveUserForIdentity({
        subject: randomUUID(),
        email: "maya.chen@leavetrack.demo",
      });

      expect(resolved).toBeNull();
    } finally {
      await getDb()`
        update users
        set auth_subject = null
        where id = ${MAYA_ID}
      `;
    }
  });
});
