import { GoogleMailboxConnect } from "./google-connect";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Inbox,
  Loader2,
  Mail,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Star,
  X,
  FileText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  mailboxRequest as api,
  type MailAccount,
  type MailMessage,
  type MailDraft,
} from "@/core/mailbox/api";
import "./mail.css";

type Folder = "inbox" | "sent" | "drafts";
const messageKey = (message: MailMessage) =>
  `${message.account_id}:${message.id}`;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试。";

export default function MailPage() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [booting, setBooting] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [folder, setFolder] = useState<Folder>("inbox");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [detail, setDetail] = useState<MailMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [limit, setLimit] = useState(50);
  const [total, setTotal] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  const [unread, setUnread] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [sendId, setSendId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [summary, setSummary] = useState("");
  const readGeneration = useRef(0);

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(
        (await api<{ accounts: MailAccount[] }>("/accounts")).accounts,
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBooting(false);
    }
  }, []);
  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setMessages([]);
    setTotal(0);
    if (folder === "drafts") {
      void api<{ drafts: MailDraft[] }>("/drafts", {
        signal: controller.signal,
      })
        .then((data) => {
          if (!cancelled) setDrafts(data.drafts);
        })
        .catch((err) => {
          if (!cancelled) setError(errorText(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      const targets = accounts.filter(
        (account) => !accountId || account.id === accountId,
      );
      void Promise.allSettled(
        targets.map(async (account) => ({
          account,
          data: await api<{ messages: MailMessage[]; total: number }>(
            `/accounts/${account.id}/messages?folder=${folder}&limit=${limit}`,
            { signal: controller.signal },
          ),
        })),
      ).then((results) => {
        if (cancelled) return;
        const items: MailMessage[] = [];
        const errors: string[] = [];
        let count = 0;
        results.forEach((result, index) => {
          if (result.status === "fulfilled") {
            items.push(...result.value.data.messages);
            count += result.value.data.total;
          } else
            errors.push(
              `${targets[index]?.email}：${errorText(result.reason)}`,
            );
        });
        setMessages(items.sort((a, b) => b.date - a.date));
        setTotal(count);
        setError(errors.join("；"));
        setLoading(false);
      });
    }
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accounts, accountId, folder, refresh, limit]);
  useEffect(() => {
    // A generation counter, not a DOM ref: cleanup bumps it so replies to a
    // superseded read are ignored.
    const generations = readGeneration;
    const generation = ++generations.current;
    setDetail(null);
    setSummary("");
    setReading(false);
    if (!selected || folder === "drafts") return;
    setReading(true);
    void api<MailMessage>(
      `/accounts/${selected.account_id}/messages/${selected.id}?folder=${folder}`,
    )
      .then((data) => {
        if (readGeneration.current === generation) setDetail(data);
      })
      .catch((err) => {
        if (readGeneration.current === generation) setError(errorText(err));
      })
      .finally(() => {
        if (readGeneration.current === generation) setReading(false);
      });
    return () => {
      ++generations.current;
    };
  }, [selected, folder]);

  const changeFolder = (next: Folder, account = accountId) => {
    setFolder(next);
    setAccountId(account);
    setSelected(null);
    setQuery("");
    setLimit(50);
    setUnread(false);
  };
  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setConnecting(true);
    setConnectError("");
    try {
      await api("/accounts", { method: "POST", body: { email, password } });
      setPassword("");
      setEmail("");
      await loadAccounts();
      setSettings(false);
      setNotice("Gmail 已连接");
    } catch (err) {
      setConnectError(errorText(err));
    } finally {
      setConnecting(false);
    }
  };
  const updateFlag = async (message: MailMessage, flag: "read" | "starred") => {
    try {
      await api(
        `/accounts/${message.account_id}/messages/${message.id}?folder=${folder}`,
        { method: "PATCH", body: { [flag]: !message[flag] } },
      );
      setMessages((items) =>
        items.map((item) =>
          messageKey(item) === messageKey(message)
            ? { ...item, [flag]: !message[flag] }
            : item,
        ),
      );
      setDetail((current) =>
        current && messageKey(current) === messageKey(message)
          ? { ...current, [flag]: !message[flag] }
          : current,
      );
    } catch (err) {
      setError(errorText(err));
    }
  };
  const openDraft = (existing?: MailDraft, reply?: MailMessage) => {
    const draftId = existing?.id || crypto.randomUUID();
    setDraft(
      existing ?? {
        id: draftId,
        account_id: reply?.account_id || accountId || accounts[0]?.id || "",
        to: reply?.reply_to || "",
        subject: reply
          ? /^re:/i.test(reply.subject)
            ? reply.subject
            : `Re: ${reply.subject}`
          : "",
        body: "",
        reply_message_id: reply?.message_id || "",
        source_id: reply?.id || "",
        source_account_id: reply?.account_id || "",
        source_folder: folder === "sent" ? "sent" : "inbox",
      },
    );
    setSendId(draftId);
    setInstruction("");
    setDraftError("");
  };
  const save = async (close = false) => {
    if (!draft) return;
    setSaving(true);
    setDraftError("");
    try {
      await api("/drafts", { method: "POST", body: draft });
      if (close) setDraft(null);
      setNotice("草稿已保存到 Echo");
      setRefresh((n) => n + 1);
    } catch (err) {
      setDraftError(errorText(err));
    } finally {
      setSaving(false);
    }
  };
  const send = async () => {
    if (!draft) return;
    setSending(true);
    setDraftError("");
    try {
      const result = await api<{ refused: string[] }>("/send", {
        method: "POST",
        body: { ...draft, request_id: sendId },
      });
      setDraft(null);
      setNotice(
        result.refused.length
          ? `部分收件人未接收：${result.refused.join("、")}`
          : "邮件已发送",
      );
      setRefresh((n) => n + 1);
    } catch (err) {
      setDraftError(errorText(err));
    } finally {
      setSending(false);
    }
  };
  const assist = async (action: "summary" | "draft") => {
    setAiBusy(true);
    setDraftError("");
    const generation = readGeneration.current;
    try {
      const source = action === "summary" ? detail : null;
      const result = await api<{ text: string }>("/assist", {
        method: "POST",
        body: {
          action,
          account_id:
            source?.account_id ||
            draft?.source_account_id ||
            draft?.account_id ||
            "",
          folder:
            action === "draft"
              ? draft?.source_folder || "inbox"
              : folder === "sent"
                ? "sent"
                : "inbox",
          message_id:
            source?.id || (action === "draft" ? draft?.source_id : "") || "",
          instruction: action === "draft" ? instruction : "",
          draft: draft?.body || "",
        },
      });
      if (action === "draft")
        setDraft((current) =>
          current ? { ...current, body: result.text } : null,
        );
      else if (generation === readGeneration.current) setSummary(result.text);
    } catch (err) {
      if (action === "draft") setDraftError(errorText(err));
      else setError(errorText(err));
    } finally {
      setAiBusy(false);
    }
  };
  const visible = messages.filter(
    (message) =>
      (!unread || !message.read) &&
      `${message.subject} ${message.sender} ${message.to}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const busyDraft = saving || sending || aiBusy;

  return (
    <main className="mail-app">
      <aside className="mail-sidebar">
        <div className="mail-brand">
          <span className="mail-logo">
            <Mail size={19} />
          </span>
          <strong>邮箱</strong>
          <span>Echo</span>
        </div>
        <button
          className="mail-primary mail-compose"
          disabled={!accounts.length}
          onClick={() => openDraft()}
        >
          <PenLine size={16} />
          写邮件
        </button>
        <nav aria-label="邮件文件夹">
          <button
            className={folder === "inbox" ? "is-active" : ""}
            onClick={() => changeFolder("inbox", "")}
          >
            <Inbox size={17} />
            全部收件箱
          </button>
          <button
            className={folder === "sent" ? "is-active" : ""}
            onClick={() => changeFolder("sent")}
          >
            <Send size={17} />
            已发送
          </button>
          <button
            className={folder === "drafts" ? "is-active" : ""}
            onClick={() => changeFolder("drafts")}
          >
            <FileText size={17} />
            Echo 草稿
          </button>
        </nav>
        <div className="mail-account-label">
          已连接账户
          <button aria-label="添加邮箱" onClick={() => setSettings(true)}>
            <Plus size={15} />
          </button>
        </div>
        {accounts.map((account) => (
          <button
            className={`mail-account ${accountId === account.id ? "is-active" : ""}`}
            key={account.id}
            onClick={() => changeFolder("inbox", account.id)}
          >
            <span className="mail-account-dot" />
            <span>{account.email}</span>
          </button>
        ))}
        {!accounts.length && (
          <p className="mail-sidebar-hint">连接 Gmail，集中处理你的邮件。</p>
        )}
        <button className="mail-settings" onClick={() => setSettings(true)}>
          <Settings2 size={16} />
          管理邮箱
        </button>
      </aside>
      <section className={`mail-main ${selected ? "mail-has-selection" : ""}`}>
        <header className="mail-toolbar">
          <h1>
            {folder === "drafts"
              ? "草稿"
              : folder === "sent"
                ? "已发送"
                : accountId
                  ? "收件箱"
                  : "全部收件箱"}
          </h1>
          <label className="mail-search">
            <Search size={16} />
            <input
              aria-label="搜索已加载邮件"
              placeholder="搜索已加载邮件"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            title="刷新邮件"
            aria-label="刷新邮件"
            disabled={loading}
            onClick={() => {
              void loadAccounts();
              setRefresh((n) => n + 1);
            }}
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </header>
        {error && (
          <div role="alert" className="mail-error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="mail-notice">
            <Check size={14} />
            {notice}
            <button aria-label="关闭提示" onClick={() => setNotice("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {booting ? (
          <div className="mail-empty">
            <Loader2 className="animate-spin" />
            正在读取邮箱设置…
          </div>
        ) : !accounts.length ? (
          <div className="mail-empty mail-onboarding">
            <span className="mail-onboarding-icon">
              <Mail size={32} />
            </span>
            <h2>邮件，都在这里</h2>
            <p>集中查看多个 Gmail 账户，让助手读懂来信、帮你写回复。</p>
            <button className="mail-primary" onClick={() => setSettings(true)}>
              <Plus size={16} />
              连接 Gmail
            </button>
            <div className="mail-features">
              <span>
                <Inbox size={18} />
                统一收件箱
              </span>
              <span>
                <Sparkles size={18} />
                总结邮件内容
              </span>
              <span>
                <PenLine size={18} />
                起草与回复
              </span>
            </div>
          </div>
        ) : (
          <div className="mail-columns">
            <section className="mail-list" aria-label="邮件列表">
              <div className="mail-list-meta">
                <span>
                  {folder === "drafts"
                    ? `${drafts.length} 封草稿`
                    : `已加载 ${messages.length} / ${total} 封`}
                </span>
                {folder !== "drafts" && (
                  <button
                    className={unread ? "is-active" : ""}
                    onClick={() => setUnread(!unread)}
                  >
                    仅未读
                  </button>
                )}
              </div>
              {loading && (
                <div className="mail-list-loading">
                  <Loader2 size={16} className="animate-spin" />
                  正在同步邮件…
                </div>
              )}
              {folder === "drafts"
                ? drafts
                    .filter(
                      (item) =>
                        (!accountId || item.account_id === accountId) &&
                        `${item.subject} ${item.to}`.includes(query),
                    )
                    .map((item) => (
                      <button
                        className="mail-row"
                        key={item.id}
                        onClick={() => openDraft(item)}
                      >
                        <strong>{item.subject || "（无主题草稿）"}</strong>
                        <span>{item.to || "未填写收件人"}</span>
                        <small>{item.body.slice(0, 70) || "继续撰写…"}</small>
                      </button>
                    ))
                : visible.map((message) => (
                    <button
                      key={messageKey(message)}
                      className={`mail-row ${!message.read ? "is-unread" : ""} ${selected && messageKey(selected) === messageKey(message) ? "is-selected" : ""}`}
                      onClick={() => setSelected(message)}
                    >
                      <div>
                        <strong>{message.sender}</strong>
                        <time>
                          {message.date
                            ? new Date(message.date * 1000).toLocaleDateString(
                                undefined,
                                { month: "short", day: "numeric" },
                              )
                            : ""}
                        </time>
                      </div>
                      <span>{message.subject}</span>
                      <small>
                        {
                          accounts.find(
                            (account) => account.id === message.account_id,
                          )?.email
                        }
                        {message.starred && (
                          <Star size={12} fill="currentColor" />
                        )}
                      </small>
                    </button>
                  ))}
              {!loading &&
                (folder === "drafts" ? !drafts.length : !visible.length) && (
                  <p className="mail-list-loading">
                    {query || unread ? "没有匹配的邮件" : "这里还没有邮件"}
                  </p>
                )}
              {folder !== "drafts" &&
                total > messages.length &&
                limit < 200 && (
                  <button
                    className="mail-load-more"
                    disabled={loading}
                    onClick={() => setLimit((value) => value + 50)}
                  >
                    加载更早的邮件
                  </button>
                )}
              {folder !== "drafts" &&
                total > messages.length &&
                limit >= 200 && (
                  <p className="mail-list-loading">
                    当前展示每个账户最近 200 封邮件
                  </p>
                )}
            </section>
            <section className="mail-reader" aria-label="邮件详情">
              {reading ? (
                <div className="mail-empty">
                  <Loader2 className="animate-spin" />
                  正在读取邮件…
                </div>
              ) : detail ? (
                <>
                  <div className="mail-reader-actions">
                    <button
                      className="mail-mobile-back"
                      onClick={() => setSelected(null)}
                    >
                      <ArrowLeft size={16} />
                      返回
                    </button>
                    <button onClick={() => void updateFlag(detail, "read")}>
                      <Mail size={15} />
                      {detail.read ? "标为未读" : "标为已读"}
                    </button>
                    <button
                      aria-label={detail.starred ? "取消星标" : "加星标"}
                      onClick={() => void updateFlag(detail, "starred")}
                    >
                      <Star
                        size={16}
                        fill={detail.starred ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      className="mail-ai-action"
                      disabled={aiBusy}
                      onClick={() => void assist("summary")}
                    >
                      <Sparkles size={15} />
                      {aiBusy ? "正在整理…" : "帮我读邮件"}
                    </button>
                  </div>
                  <article className="mail-content">
                    <h2>{detail.subject}</h2>
                    <div className="mail-envelope">
                      <strong>{detail.sender}</strong>
                      <span>收件人：{detail.to}</span>
                      <time>
                        {detail.date
                          ? new Date(detail.date * 1000).toLocaleString()
                          : ""}
                      </time>
                    </div>
                    {summary && (
                      <section className="mail-summary">
                        <h3>
                          <Sparkles size={16} />
                          助手摘要
                        </h3>
                        <p>{summary}</p>
                      </section>
                    )}
                    <div className="mail-body">
                      {detail.body || "这封邮件没有可显示的文字正文。"}
                    </div>
                    {detail.truncated && (
                      <p className="mail-sidebar-hint">
                        正文较长，当前显示前 100,000 个字符。
                      </p>
                    )}
                    {detail.attachments.length > 0 && (
                      <div className="mail-attachments">
                        <strong>附件</strong>
                        {detail.attachments.map((name, index) => (
                          <span key={index}>
                            <FileText size={14} />
                            {name}
                          </span>
                        ))}
                        <a
                          href="https://mail.google.com/"
                          target="_blank"
                          rel="noreferrer"
                        >
                          前往 Gmail 下载附件
                        </a>
                      </div>
                    )}
                    <button
                      className="mail-reply"
                      onClick={() => openDraft(undefined, detail)}
                    >
                      <PenLine size={16} />
                      回复邮件
                    </button>
                  </article>
                </>
              ) : (
                <div className="mail-empty">
                  <Mail size={32} strokeWidth={1.25} />
                  <h2>选择一封邮件</h2>
                  <p>阅读来信，或让助手提炼重点。</p>
                </div>
              )}
            </section>
          </div>
        )}
      </section>

      <Dialog
        open={settings}
        onOpenChange={(open) => {
          if (!connecting) {
            setSettings(open);
            setPassword("");
            setConnectError("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>管理邮箱</DialogTitle>
            <DialogDescription>
              连接多个 Gmail 账户，统一收取和撰写邮件。
            </DialogDescription>
          </DialogHeader>
          {accounts.length > 0 && (
            <div className="mail-connected">
              {accounts.map((account) => (
                <div key={account.id}>
                  <span>{account.email}</span>
                  <button
                    disabled={connecting}
                    onClick={async () => {
                      try {
                        await api(`/accounts/${account.id}`, {
                          method: "DELETE",
                        });
                        if (accountId === account.id) setAccountId("");
                        setSelected(null);
                        await loadAccounts();
                      } catch (err) {
                        setConnectError(errorText(err));
                      }
                    }}
                  >
                    断开连接
                  </button>
                </div>
              ))}
            </div>
          )}
          <GoogleMailboxConnect
            onConnected={() => {
              void loadAccounts();
              setSettings(false);
              setNotice("Gmail 已通过 Google 授权连接");
            }}
          />
          <details className="mail-password-fallback">
            <summary>其他方式：应用专用密码</summary>
            <form
              className="mail-connect-form"
              onSubmit={(event) => void connect(event)}
            >
              <label>
                Gmail 地址
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@gmail.com"
                />
              </label>
              <label>
                应用专用密码
                <input
                  type="password"
                  required
                  autoComplete="off"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Google 生成的 16 位密码"
                  maxLength={32}
                />
              </label>
              <p>
                先开启 Google 两步验证，再生成应用专用密码。凭据加密保存在 Echo
                后端，不进入聊天记录。
              </p>
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
              >
                打开 Google 应用专用密码设置 ↗
              </a>
              <p>
                如果你的账户没有此选项，可能受到组织策略或高级保护限制，当前接入方式暂不适用。
              </p>
              {connectError && (
                <p role="alert" className="mail-error">
                  {connectError}
                </p>
              )}
              <button className="mail-primary" disabled={connecting}>
                {connecting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Plus size={16} />
                )}{" "}
                {connecting ? "验证并连接…" : "连接 Gmail"}
              </button>
            </form>
          </details>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !busyDraft) void save(true);
        }}
      >
        <DialogContent className="mail-compose-dialog sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {draft?.reply_message_id ? "回复邮件" : "写邮件"}
            </DialogTitle>
            <DialogDescription>
              助手生成的内容可以编辑；点击「发送邮件」后才会发送。
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="mail-editor">
              <label>
                发件人
                <select
                  disabled={busyDraft}
                  value={draft.account_id}
                  onChange={(event) =>
                    setDraft({ ...draft, account_id: event.target.value })
                  }
                >
                  <option value="" disabled>
                    选择邮箱
                  </option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.email}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                收件人
                <input
                  disabled={busyDraft}
                  value={draft.to}
                  placeholder="多个收件人用逗号分隔"
                  onChange={(event) =>
                    setDraft({ ...draft, to: event.target.value })
                  }
                />
              </label>
              <label>
                主题
                <input
                  disabled={busyDraft}
                  value={draft.subject}
                  onChange={(event) =>
                    setDraft({ ...draft, subject: event.target.value })
                  }
                />
              </label>
              <textarea
                aria-label="邮件正文"
                disabled={busyDraft}
                value={draft.body}
                onChange={(event) =>
                  setDraft({ ...draft, body: event.target.value })
                }
                placeholder="写下你的邮件，或告诉助手你想表达什么…"
              />
              <div className="mail-write-assist">
                <Sparkles size={17} />
                <input
                  aria-label="邮件写作要求"
                  disabled={busyDraft}
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder="例如：礼貌确认周五开会，请对方发来议程"
                />
                <button
                  disabled={busyDraft || !instruction.trim()}
                  onClick={() => void assist("draft")}
                >
                  {aiBusy ? "起草中…" : "帮我写"}
                </button>
              </div>
              {draftError && (
                <p role="alert" className="mail-error">
                  {draftError}
                </p>
              )}
              <footer>
                <button disabled={busyDraft} onClick={() => void save()}>
                  {saving ? "保存中…" : "保存草稿"}
                </button>
                <button
                  className="mail-primary"
                  disabled={
                    busyDraft ||
                    !draft.to.trim() ||
                    !draft.body.trim() ||
                    !accounts.some((account) => account.id === draft.account_id)
                  }
                  onClick={() => void send()}
                >
                  <Send size={15} />
                  {sending ? "发送中…" : "发送邮件"}
                </button>
              </footer>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
