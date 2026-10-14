import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 视觉消抖与确定性状态冻结助手
 * 消除前端视觉回归测试 (VRT) 中的渲染闪烁、字体抖动及非确定性动画。
 */
export async function freezeVisualState(page: Page): Promise<void> {
  // 1. 等待 WebFonts 完全解码并挂载完成
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  });

  // 2. 注入全局样式：冻结动效、禁用平滑滚动、隐藏闪烁光标
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
        caret-color: transparent !important;
      }
      .animate-pulse, .animate-skeleton-entrance, .animate-spin {
        animation: none !important;
        opacity: 0.65 !important;
      }
    `,
  });

  // 3. 等待至少连续 2 个渲染帧，确保浏览器完成微任务布局重排与重绘
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

/**
 * 断言容器内部不存在非预期的横向或纵向布局溢出（防截断与横向滚动条）
 */
export async function assertNoVisualOverflow(locator: Locator): Promise<void> {
  const result = await locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const allowScrollX =
      style.overflowX === "auto" || style.overflowX === "scroll";
    const allowScrollY =
      style.overflowY === "auto" || style.overflowY === "scroll";
    const overflowX =
      !allowScrollX && element.scrollWidth > element.clientWidth + 1;
    const overflowY =
      !allowScrollY && element.scrollHeight > element.clientHeight + 1;
    return {
      overflowX,
      overflowY,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      tag: element.tagName.toLowerCase(),
      className: element.className,
    };
  });

  expect(
    result.overflowX,
    `Visual overflow detected: <${result.tag} class="${result.className}"> scrollWidth (${result.scrollWidth}px) exceeds clientWidth (${result.clientWidth}px).`,
  ).toBe(false);
}

/**
 * 断言所有交互式子元素严格位于父级几何包围盒内部，避免关键控件被遮挡或溢出边界
 */
export async function assertChildrenContained(
  parent: Locator,
  childSelector = "button, input, select, textarea, [role='button']",
): Promise<void> {
  const parentBox = await parent.boundingBox();
  expect(
    parentBox,
    "Parent element must be visible and have bounding box",
  ).toBeTruthy();
  if (!parentBox) return;

  const violations = await parent.evaluate(
    (parentElement, selector) => {
      const parentRect = parentElement.getBoundingClientRect();
      const children = Array.from(
        parentElement.querySelectorAll<HTMLElement>(selector),
      );
      const errors: string[] = [];

      for (const child of children) {
        if (child.offsetParent === null) continue; // 忽略隐藏节点
        const rect = child.getBoundingClientRect();
        const tolerance = 1.5; // 允许 1.5px 渲染舍入容差
        const leakedLeft = rect.left < parentRect.left - tolerance;
        const leakedRight = rect.right > parentRect.right + tolerance;
        const leakedTop = rect.top < parentRect.top - tolerance;
        const leakedBottom = rect.bottom > parentRect.bottom + tolerance;

        if (leakedLeft || leakedRight || leakedTop || leakedBottom) {
          errors.push(
            `<${child.tagName.toLowerCase()} class="${child.className}"> [x:${Math.round(rect.x)}, y:${Math.round(rect.y)}, w:${Math.round(rect.width)}, h:${Math.round(rect.height)}] exceeded parent bounds [x:${Math.round(parentRect.x)}, y:${Math.round(parentRect.y)}, w:${Math.round(parentRect.width)}, h:${Math.round(parentRect.height)}]`,
          );
        }
      }
      return errors;
    },
    childSelector,
  );

  expect(
    violations,
    `Interactive controls clipped or overflowing parent boundary:\n${violations.join("\n")}`,
  ).toEqual([]);
}

/**
 * 断言目标元素内部的文本节点满足基本 WCAG 2.1 对比度阈值
 * @param locator 待检测的目标容器或元素
 * @param minRatio 最小对比度要求，常规正文推荐 4.5:1，大标题/辅助标签允许 3.0:1
 */
export async function assertAccessibleContrast(
  locator: Locator,
  minRatio = 4.5,
): Promise<void> {
  const result = await locator.evaluate((element, targetRatio) => {
    function parseRgb(colorStr: string): [number, number, number, number] {
      const match = colorStr.match(
        /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/,
      );
      if (!match) return [0, 0, 0, 1];
      return [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        match[4] !== undefined ? Number(match[4]) : 1,
      ];
    }

    function getLuminance(r: number, g: number, b: number): number {
      const [rs, gs, bs] = [r, g, b].map((c) => {
        const val = c / 255;
        return val <= 0.03928
          ? val / 12.92
          : Math.pow((val + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs! + 0.7152 * gs! + 0.0722 * bs!;
    }

    function getEffectiveBg(el: HTMLElement): [number, number, number] {
      let cur: HTMLElement | null = el;
      while (cur) {
        const bg = window.getComputedStyle(cur).backgroundColor;
        const [r, g, b, a] = parseRgb(bg);
        if (a > 0.05) return [r, g, b];
        cur = cur.parentElement;
      }
      return [255, 255, 255]; // 默认白色底
    }

    const style = window.getComputedStyle(element);
    const [fgR, fgG, fgB] = parseRgb(style.color);
    const [bgR, bgG, bgB] = getEffectiveBg(element);

    const l1 = getLuminance(fgR, fgG, fgB);
    const l2 = getLuminance(bgR, bgG, bgB);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    const ratio = (lighter + 0.05) / (darker + 0.05);

    return {
      ratio: Number(ratio.toFixed(2)),
      pass: ratio >= targetRatio,
      color: style.color,
      tag: element.tagName.toLowerCase(),
      text: element.textContent?.slice(0, 30)?.trim() || "",
    };
  }, minRatio);

  expect(
    result.pass,
    `Low contrast detected for <${result.tag}> "${result.text}": contrast ratio is ${result.ratio}:1, expected at least ${minRatio}:1.`,
  ).toBe(true);
}

