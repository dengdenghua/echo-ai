import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

type Person = { context: BrowserContext; page: Page; events: string[] };

async function person(
  browser: Browser,
  baseURL: string,
  username: string,
): Promise<Person> {
  const context = await browser.newContext({ baseURL });
  const login = await context.request.post("/api/auth/local/login", {
    data: { username },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const auth = await login.json();
  expect(auth.access_token).toBeTruthy();
  await context.setExtraHTTPHeaders({
    Authorization: `Bearer ${auth.access_token}`,
  });
  await context.addInitScript(
    ({ token, user }) => {
      sessionStorage.setItem("echo_auth_token", token);
      sessionStorage.setItem("echo_user", JSON.stringify(user));
      sessionStorage.setItem("echo_auth_ts", String(Date.now()));
      localStorage.setItem("echo_locale", "en-US");
    },
    { token: auth.access_token, user: auth.user },
  );
  const page = await context.newPage();
  const events: string[] = [];
  page.on("pageerror", (error) => events.push(`pageerror: ${error.message}`));
  page.on("websocket", (socket) => {
    socket.on("framereceived", (frame) => {
      const data = JSON.parse(String(frame.payload));
      if (["thread:update", "ready", "error"].includes(data.type))
        events.push(`socket: ${JSON.stringify(data)}`);
    });
  });
  page.on("response", async (response) => {
    if (response.url().endsWith("/reactions"))
      events.push(
        `${response.request().method()} reactions ${response.status()} ${await response.text().catch(() => "closed")}`,
      );
  });
  return { context, page, events };
}

async function group(owner: Person) {
  const thread = await owner.context.request.post("/api/threads", {
    data: { metadata: { title: "E2E collaboration", agent_id: "general" } },
  });
  expect(thread.ok(), await thread.text()).toBeTruthy();
  const created = await thread.json();
  const id = created.thread_id;
  expect(id).toBeTruthy();
  const roster = await owner.context.request.put(`/api/cowork/${id}/roster`, {
    data: { agent_ids: ["eve"], mode: "chat" },
  });
  expect(roster.ok(), await roster.text()).toBeTruthy();
  const room = await owner.context.request.post(`/api/collab/${id}/room`, {
    data: {
      name: "E2E collaboration",
      members: [{ name: "general", display_name: "Echo" }],
      leaderId: "general",
      mode: "chat",
    },
  });
  expect(room.ok(), await room.text()).toBeTruthy();
  return { threadId: id as string, room: (await room.json()).room };
}

async function invite(owner: Person, roomId: string, role = "member") {
  const response = await owner.context.request.post(
    `/api/teams/${roomId}/invites`,
    {
      data: { role, expires_in_seconds: 3600, max_uses: 3 },
    },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function join(
  member: Person,
  invitation: { invite_hash_path: string },
  name: string,
) {
  await member.page.goto(invitation.invite_hash_path);
  await member.page.locator("main input, input[placeholder]").last().fill(name);
  await member.page
    .getByRole("button", { name: "Join task", exact: true })
    .click();
  await expect(member.page.getByTestId("chat-composer-input")).toBeVisible({
    timeout: 20_000,
  });
}

async function roomMessage(
  owner: Person,
  threadId: string,
  text: string,
  sourceId?: string,
) {
  const response = await owner.context.request.post(
    `/api/collab/${threadId}/room-message`,
    {
      data: { text, ...(sourceId ? { source_message_id: sourceId } : {}) },
    },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test("message reactions, pins, comments, replies and reconnect stay shared", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const alice = await person(browser, baseURL!, "alice");
  const bob = await person(browser, baseURL!, "bob");
  try {
    const { threadId, room } = await group(alice);
    await alice.page.goto(`/#/workspace/realtime/${threadId}`);
    await join(bob, await invite(alice, room.id), "Bob");
    const text = "Review the shared launch checklist";
    const posted = await roomMessage(
      alice,
      threadId,
      text,
      "e2e-shared-message",
    );
    const seq = posted.message?.seq ?? posted.seq;
    const ownerRow = alice.page.locator(`article[data-message-seq="${seq}"]`);
    const memberRow = bob.page.locator(`article[data-message-seq="${seq}"]`);
    await expect(ownerRow).toContainText(text);
    await expect(memberRow).toContainText(text);
    await memberRow.hover();
    await memberRow
      .getByRole("button", { name: "添加消息回应", exact: true })
      .click();
    const reactionResponse = bob.page.waitForResponse(
      (r) => r.url().endsWith("/reactions") && r.request().method() === "POST",
    );
    await memberRow
      .getByRole("button", { name: "用 👍 回应", exact: true })
      .click();
    const reaction = await reactionResponse;
    expect(reaction.ok(), await reaction.text()).toBeTruthy();
    await expect(
      memberRow.getByRole("button", { name: "👍 1 人回应" }),
    ).toBeVisible();
    const sharedReactions = await alice.context.request.get(
      `/api/collab/${threadId}/reactions`,
    );
    await info.attach("reactions", {
      body: await sharedReactions.body(),
      contentType: "application/json",
    });
    await expect(
      ownerRow.getByRole("button", { name: "👍 1 人回应" }),
    ).toBeVisible();
    await ownerRow.hover();
    await ownerRow
      .getByRole("button", { name: "置顶消息", exact: true })
      .click();
    await expect(
      memberRow.getByRole("button", { name: "取消置顶消息", exact: true }),
    ).toBeAttached();
    await memberRow
      .getByRole("button", { name: "Add comment", exact: true })
      .click();
    await memberRow
      .getByPlaceholder("Add a comment...")
      .fill("Bob verified the checklist");
    await memberRow
      .getByRole("button", { name: "Comment", exact: true })
      .click();
    await ownerRow
      .getByRole("button", { name: "查看 1 条批注", exact: true })
      .click();
    await expect(ownerRow).toContainText("Bob verified the checklist");
    await memberRow
      .getByRole("button", { name: "回复消息", exact: true })
      .click();
    await expect(bob.page.getByTestId("chat-composer-input")).toHaveValue(
      new RegExp(text),
    );
    await roomMessage(alice, threadId, text, "e2e-shared-message");
    await expect(
      bob.page.locator(`article[data-message-seq="${seq}"]`),
    ).toHaveCount(1);
    await bob.context.setOffline(true);
    await roomMessage(alice, threadId, "Message posted while Bob was offline");
    await bob.context.setOffline(false);
    await bob.page.reload();
    await expect(
      bob.page.getByText("Message posted while Bob was offline", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      memberRow.getByRole("button", { name: "👍 1 人回应" }),
    ).toBeVisible();
    await bob.page.screenshot({
      path: info.outputPath("shared-message-actions.png"),
      fullPage: true,
    });
  } finally {
    await info.attach("realtime-events", {
      body: JSON.stringify({ alice: alice.events, bob: bob.events }),
      contentType: "application/json",
    });
    await alice.context.close();
    await bob.context.close();
  }
});

test("viewer can read but cannot submit or manage the group", async ({
  browser,
  baseURL,
}, info) => {
  const alice = await person(browser, baseURL!, "alice");
  const viewer = await person(browser, baseURL!, "viewer");
  try {
    const { threadId, room } = await group(alice);
    await roomMessage(alice, threadId, "Visible to the read-only participant");
    await join(
      viewer,
      await invite(alice, room.id, "viewer"),
      "Read-only viewer",
    );
    await expect(
      viewer.page.getByText("Visible to the read-only participant", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(viewer.page.getByTestId("chat-composer-input")).toBeDisabled();
    await expect(
      viewer.page.locator('[data-slot="task-collaborator-trigger"]'),
    ).toHaveCount(0);
    await expect(
      viewer.page.getByRole("button", { name: "添加消息回应", exact: true }),
    ).toBeDisabled();
    await expect(
      viewer.page.getByRole("button", { name: "Add comment", exact: true }),
    ).toHaveCount(0);
    const denied = await viewer.context.request.post(
      `/api/collab/${threadId}/room-message`,
      { data: { text: "forbidden" } },
    );
    expect([403, 404]).toContain(denied.status());
    await viewer.page.screenshot({
      path: info.outputPath("viewer.png"),
      fullPage: true,
    });
  } finally {
    await alice.context.close();
    await viewer.context.close();
  }
});

test("project membership approval survives applicant refresh", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const alice = await person(browser, baseURL!, "alice");
  const bob = await person(browser, baseURL!, "bob");
  try {
    const project = await alice.context.request.post("/api/projects/group", {
      data: {
        name: "Shared approval project",
        goal: "Review launch readiness",
        initial_agents: [{ id: "eve" }],
      },
    });
    expect(project.ok(), await project.text()).toBeTruthy();
    const created = await project.json();
    const threadId = created.thread_id;
    const room = created.room;
    expect(threadId).toBeTruthy();
    const invitation = await invite(alice, room.id);
    await bob.page.goto(invitation.invite_hash_path);
    await bob.page.getByPlaceholder("Your display name").fill("Bob reviewer");
    await bob.page
      .getByRole("button", { name: "Request to join", exact: true })
      .click();
    await expect(
      bob.page.getByText("Request submitted", { exact: true }),
    ).toBeVisible();
    await bob.page.reload();
    await expect(
      bob.page.getByText("Request submitted", { exact: true }),
    ).toBeVisible();
    expect([403, 404]).toContain(
      (await bob.context.request.get(`/api/collab/${threadId}`)).status(),
    );
    await alice.page.goto(`/#/workspace/realtime/${threadId}`);
    await alice.page
      .locator('[data-slot="task-collaborator-trigger"]')
      .first()
      .click();
    const pendingRequests = alice.page.waitForResponse(
      (response) => response.request().method() === "GET" &&
        response.url().includes(`/api/teams/${room.id}/join-requests?status=pending`),
    );
    await alice.page
      .getByRole("button", { name: "Invite people", exact: true })
      .click();
    const requests = await pendingRequests;
    expect(requests.ok(), await requests.text()).toBeTruthy();
    const dialog = alice.page.getByRole("dialog", {
      name: "Invite people to this workgroup",
    });
    await expect(dialog).toContainText("Bob reviewer");
    await dialog.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(bob.page).toHaveURL(new RegExp(threadId), { timeout: 15_000 });
    await expect(bob.page.getByTestId("chat-composer-input")).toBeEnabled();
    await alice.page.keyboard.press("Escape");
    await bob.page
      .getByTestId("chat-composer-input")
      .fill("The team approved the launch checklist");
    await bob.page.getByTestId("chat-send-button").click();
    const decision = alice.page
      .locator("article[data-message-seq]")
      .filter({ hasText: "The team approved the launch checklist" });
    await expect(decision).toBeVisible({ timeout: 20_000 });
    await expect(decision).toContainText("Bob reviewer");
    await decision.hover();
    await decision
      .getByRole("button", { name: "消息项目操作", exact: true })
      .click();
    const savedDecision = alice.page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/project-actions"),
    );
    await alice.page.getByRole("menuitem", { name: "记录为项目决策" }).click();
    const result = await savedDecision;
    expect(result.ok(), await result.text()).toBeTruthy();
    await bob.page.screenshot({
      path: info.outputPath("approved-project-member.png"),
      fullPage: true,
    });
  } finally {
    await alice.context.close();
    await bob.context.close();
  }
});

test("AI roster changes are staged, cancelable and durable", async ({
  browser,
  baseURL,
}) => {
  const alice = await person(browser, baseURL!, "alice");
  try {
    const { threadId } = await group(alice);
    await alice.page.goto(`/#/workspace/realtime/${threadId}`);
    const trigger = alice.page
      .locator('[data-slot="task-collaborator-trigger"]')
      .first();
    await trigger.click();
    const choice = alice.page
      .locator('button[data-capability-kind][aria-pressed="false"]')
      .filter({ hasText: "Kane" });
    await expect(choice).toBeVisible();
    await choice.click();
    await alice.page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(
      alice.page.locator("button[data-capability-kind]"),
    ).toHaveCount(0);
    await trigger.click();
    await expect(choice).toBeVisible();
    await choice.click();
    const saved = alice.page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        r.url().endsWith(`/api/cowork/${threadId}/roster`),
    );
    await alice.page
      .getByRole("button", { name: /^(创建群聊|确认成员)$/ })
      .click();
    expect((await saved).ok()).toBeTruthy();
    await alice.page.reload();
    await trigger.click();
    await expect(
      alice.page
        .locator('button[data-capability-kind][aria-pressed="true"]')
        .filter({ hasText: "Kane" }),
    ).toHaveCount(1);
  } finally {
    await alice.context.close();
  }
});

test("mobile member sends a message visible to the owner and after refresh", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const alice = await person(browser, baseURL!, "alice");
  const bob = await person(browser, baseURL!, "bob");
  try {
    const { threadId, room } = await group(alice);
    await alice.page.goto(`/#/workspace/realtime/${threadId}`);
    await bob.page.setViewportSize({ width: 390, height: 844 });
    await join(bob, await invite(alice, room.id), "Mobile Bob");
    const text = "Mobile Bob confirms the shared checklist";
    await bob.page.getByTestId("chat-composer-input").fill(text);
    await bob.page.getByTestId("chat-send-button").click();
    await expect(
      alice.page.getByText(text, { exact: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      alice.page.locator("article[data-message-seq]").filter({ hasText: text }),
    ).toContainText("Mobile Bob");
    await bob.page.reload();
    await expect(
      bob.page.getByText(text, { exact: true }).first(),
    ).toBeVisible();
    expect(
      await bob.page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await bob.page.screenshot({
      path: info.outputPath("mobile-member-message.png"),
      fullPage: true,
    });
  } finally {
    await alice.context.close();
    await bob.context.close();
  }
});

test("removed member and another tenant cannot reopen private group data", async ({
  browser,
  baseURL,
}) => {
  const alice = await person(browser, baseURL!, "alice");
  const bob = await person(browser, baseURL!, "bob");
  const outsider = await person(browser, baseURL!, "outsider");
  try {
    const { threadId, room } = await group(alice);
    await join(bob, await invite(alice, room.id), "Bob");
    const state = await (
      await alice.context.request.get(`/api/teams/${room.id}`)
    ).json();
    const member = state.participants.find(
      (p: { actor_id: string }) => p.actor_id === "local:bob",
    );
    expect(member).toBeTruthy();
    const removed = await alice.context.request.delete(
      `/api/teams/${room.id}/participants/${encodeURIComponent(member.id)}`,
    );
    expect(removed.ok(), await removed.text()).toBeTruthy();
    for (const denied of [bob, outsider]) {
      for (const path of [
        `/api/collab/${threadId}`,
        `/api/threads/${threadId}/state`,
      ]) {
        expect([403, 404]).toContain(
          (await denied.context.request.get(path)).status(),
        );
      }
    }
    await bob.page.reload();
    await expect(
      bob.page.getByText("E2E collaboration", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await alice.context.close();
    await bob.context.close();
    await outsider.context.close();
  }
});

test("two authenticated people join one canonical group and survive refresh", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const alice = await person(browser, baseURL!, "alice");
  const bob = await person(browser, baseURL!, "bob");
  try {
    const { threadId, room } = await group(alice);
    await alice.page.goto(`/#/workspace/realtime/${threadId}`);
    await expect(alice.page.getByTestId("chat-composer-input")).toBeVisible({
      timeout: 30_000,
    });
    await alice.page
      .locator('[data-slot="task-collaborator-trigger"]')
      .first()
      .click();
    await alice.page
      .getByRole("button", { name: "Invite people", exact: true })
      .click();
    const dialog = alice.page.getByRole("dialog", {
      name: "Invite people to this workgroup",
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Create invite link", exact: true })
      .click();
    const link = dialog.getByLabel("New invite link", { exact: true });
    await expect(link).toHaveValue(/token=/);
    await bob.page.goto(await link.inputValue());
    await expect(
      bob.page.getByRole("button", { name: "Join task", exact: true }),
    ).toBeVisible();
    await bob.page
      .getByRole("button", { name: "Join task", exact: true })
      .click();
    await expect(bob.page).toHaveURL(new RegExp(threadId));
    await expect(bob.page.getByTestId("chat-composer-input")).toBeVisible();
    await bob.page.reload();
    await expect(bob.page.getByTestId("chat-composer-input")).toBeVisible();
    const session = await bob.context.request.get(`/api/collab/${threadId}`);
    expect(session.ok(), await session.text()).toBeTruthy();
    await expect
      .poll(() => bob.events.some((e) => e.includes('"type":"ready"')))
      .toBeTruthy();
    await info.attach("owner-ui", {
      body: await alice.page.locator("body").innerText(),
      contentType: "text/plain",
    });
    await info.attach("member-ui", {
      body: await bob.page.locator("body").innerText(),
      contentType: "text/plain",
    });
    await alice.page.screenshot({
      path: info.outputPath("owner.png"),
      fullPage: true,
    });
  } finally {
    await alice.context.close();
    await bob.context.close();
  }
});
