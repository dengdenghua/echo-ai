import {
  AudioLines,
  BookOpen,
  Bot,
  ChartNoAxesCombined,
  Clapperboard,
  CodeXml,
  Database,
  FileText,
  Globe,
  GraduationCap,
  Image,
  Mail,
  Megaphone,
  Palette,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
  type LucideIcon,
} from "lucide-react";

// BRAND.md: colour carries state, never a category. Every skill family
// shares the neutral graphite tile; the line icon tells them apart.

// Match the skill's identity first; broad catalog tags are only a fallback.
const families: {
  match: RegExp;
  icon: LucideIcon;
}[] = [
  { match: /email|imap|smtp|mail|邮件|邮箱/, icon: Mail },
  {
    match: /security|safety|vuln|legal|contract|安全|法律|合同/,
    icon: ShieldCheck,
  },
  {
    match:
      /audio|voice|speech|tts|podcast|music|score|dubbing|lip|音频|音乐|配音/,
    icon: AudioLines,
  },
  {
    match:
      /video|film|cinema|anime|animation|storyboard|drama|motion|comfy|剪辑|影视|动画|短剧|动效/,
    icon: Clapperboard,
  },
  {
    match: /image|photo|inpaint|render|poster|pixel|seedream|图片|海报/,
    icon: Image,
  },
  { match: /database|sql|数据库/, icon: Database },
  {
    match:
      /data|chart|stat|hypothesis|finance|equity|stock|sizing|okr|分析|统计|金融/,
    icon: ChartNoAxesCombined,
  },
  {
    match: /browser|browse|scrap|playwright|seo|浏览|爬虫/,
    icon: Globe,
  },
  {
    match: /research|paper|science|学术|论文|研究/,
    icon: BookOpen,
  },
  {
    match: /education|course|tutor|mentor|interview|教育|课程|面试/,
    icon: GraduationCap,
  },
  {
    match: /design|visual|(?:^|-)ui(?:-|$)|brand|palette|设计|视觉/,
    icon: Palette,
  },
  {
    match: /ad-|marketing|copywriter|pricing|cro-|广告|营销/,
    icon: Megaphone,
  },
  { match: /agent|bot|swarm|智能体/, icon: Bot },
  {
    match: /devops|k8s|kubectl|terraform|deploy|cli|terminal|部署|运维/,
    icon: Terminal,
  },
  {
    match:
      /code|api|frontend|backend|fullstack|full-stack|typescript|tdd|test|git|编程|开发/,
    icon: CodeXml,
  },
  {
    match: /audit|diagnostic|inspect|probe|审计|诊断/,
    icon: ScanSearch,
  },
  {
    match: /writing|writer|report|doc|pdf|resume|content|prose|文档|写作|报告/,
    icon: FileText,
  },
  {
    match: /workflow|pipeline|automation|integration|工作流|自动化/,
    icon: Workflow,
  },
];

export function SkillIcon({
  name,
  tags = [],
}: {
  name: string;
  tags?: string[];
}) {
  const identity = name.toLowerCase().replace(/[_\s]+/g, "-");
  const family =
    families.find(({ match }) => match.test(identity)) ??
    families.find(({ match }) => match.test(tags.join(" ").toLowerCase()));
  const Icon = family?.icon ?? Sparkles;
  return (
    <span
      aria-hidden="true"
      className="grid size-10 shrink-0 place-items-center rounded-xl border border-border-default bg-muted text-foreground"
    >
      <Icon className="size-5" strokeWidth={1.7} />
    </span>
  );
}
