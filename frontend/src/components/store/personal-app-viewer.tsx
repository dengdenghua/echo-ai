import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/core/i18n/hooks";
import { creationCopy } from "@/core/i18n/locales/asset-creation";
import {
  attachPersonalAppBridge,
  personalAppDocument,
  type AppTaskRequest,
} from "@/core/apps/personal-app-bridge";
import {
  appTaskSnapshot,
  type AppTaskSnapshot,
  type PersonalAppTask,
} from "@/core/apps/personal-app-task";
import { appTaskCopy } from "@/core/i18n/locales/personal-app-task";
import { PersonalAppTaskRunner } from "./personal-app-task-runner";

export interface PersonalAppInfo {
  id: string;
  app: {
    schema: "echo.app.v1";
    id: string;
    name: string;
    description: string;
    version: string;
    permissions?: string[];
  };
}

interface PendingTask {
  task: AppTaskRequest;
  resolve: (result: AppTaskSnapshot) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function PersonalAppViewer({
  item,
  html,
}: {
  item: PersonalAppInfo;
  html: string;
}) {
  const { locale } = useI18n();
  const copy = creationCopy(locale);
  const taskCopy = appTaskCopy(locale);
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const [pendingTask, setPendingTask] = useState<PendingTask | null>(null);
  const pending = useRef<PendingTask | null>(null);
  const [activeTask, setActiveTask] = useState<PersonalAppTask | null>(null);
  const tasks = useRef(new Map<string, AppTaskSnapshot>());
  const onSnapshot = useCallback((snapshot: AppTaskSnapshot) => {
    tasks.current.set(snapshot.taskId, snapshot);
  }, []);
  const getTask = useCallback((taskId: string) => {
    const task = tasks.current.get(taskId);
    if (!task)
      throw new Error("Task does not belong to this application session");
    return task;
  }, []);
  const requestTask = useCallback(
    (task: AppTaskRequest) =>
      new Promise<AppTaskSnapshot>((resolve, reject) => {
        if (
          pending.current ||
          [...tasks.current.values()].some((value) => !value.terminal)
        ) {
          reject(new Error("An application task is already pending"));
          return;
        }
        const timer = setTimeout(() => {
          if (pending.current !== value) return;
          pending.current = null;
          setPendingTask(null);
          reject(new Error("Task review expired"));
        }, 290000);
        const value = { task, resolve, reject, timer };
        pending.current = value;
        setPendingTask(value);
      }),
    [],
  );

  useEffect(() => {
    if (!frame.current) return;
    const detach = attachPersonalAppBridge({
      frame: frame.current,
      channel,
      deploymentId: item.id,
      permissions: item.app.permissions ?? [],
      requestTask,
      getTask,
    });
    frame.current.contentWindow?.postMessage(
      { type: "echo.app.ready", channel },
      "*",
    );
    return () => {
      detach();
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current?.reject(new Error("Application closed"));
      pending.current = null;
    };
  }, [channel, item.id, item.app.permissions, requestTask, getTask]);

  const dismissTask = () => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current?.reject(new Error("Task request cancelled"));
    pending.current = null;
    setPendingTask(null);
  };
  const runTask = () => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    const task: PersonalAppTask = {
      id: `app_${crypto.randomUUID()}`,
      clientItemId: `app_input_${crypto.randomUUID()}`,
      appName: item.app.name,
      appId: item.app.id,
      deploymentId: item.id,
      request: pending.current.task,
    };
    const snapshot = appTaskSnapshot(task.id);
    // Bound retained results to this viewer, never accept arbitrary thread ids.
    if (tasks.current.size >= 20)
      tasks.current.delete(tasks.current.keys().next().value!);
    tasks.current.set(task.id, snapshot);
    setActiveTask(task);
    pending.current.resolve(snapshot);
    pending.current = null;
    setPendingTask(null);
  };

  return (
    <>
      {activeTask && (
        <PersonalAppTaskRunner
          key={activeTask.id}
          task={activeTask}
          onSnapshot={onSnapshot}
        />
      )}
      <iframe
        ref={frame}
        title={item.app.name}
        sandbox="allow-scripts allow-forms allow-downloads"
        srcDoc={personalAppDocument(html, channel)}
        onLoad={() =>
          frame.current?.contentWindow?.postMessage(
            { type: "echo.app.ready", channel },
            "*",
          )
        }
        className="min-h-0 w-full flex-1 rounded-md border"
      />
      <Dialog
        open={pendingTask !== null}
        onOpenChange={(open) => {
          if (!open) dismissTask();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.reviewTask}</DialogTitle>
            <DialogDescription>{taskCopy.review}</DialogDescription>
          </DialogHeader>
          <p className="text-sm font-medium">
            {item.app.name} · {pendingTask?.task.kind}
            {pendingTask?.task.target ? ` · ${pendingTask.task.target}` : ""}
          </p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">
            {pendingTask?.task.prompt}
          </pre>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={dismissTask}>
              {copy.cancel}
            </Button>
            <Button onClick={runTask}>{taskCopy.run}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
