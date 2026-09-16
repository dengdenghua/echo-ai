export const SEARCH_ENGINES = [
  {
    name: "Baidu",
    url: "https://www.baidu.com/s?wd=",
    icon: "Bai",
    logoUrl: "https://www.baidu.com/favicon.ico",
    accent: "bg-[#2f6bff] text-white",
  },
  {
    name: "Google",
    url: "https://www.google.com/search?q=",
    icon: "G",
    logoUrl: "https://www.google.com/favicon.ico",
    accent: "bg-white text-[#4285f4]",
  },
  {
    name: "Bing",
    url: "https://www.bing.com/search?q=",
    icon: "B",
    logoUrl: "https://www.bing.com/favicon.ico",
    accent: "bg-[#008373] text-white",
  },
  {
    name: "GitHub",
    url: "https://github.com/search?q=",
    icon: "GH",
    logoUrl: "https://github.githubassets.com/favicons/favicon.svg",
    accent: "bg-[#24292f] text-white",
  },
];

export type SearchEngine = (typeof SEARCH_ENGINES)[number];
