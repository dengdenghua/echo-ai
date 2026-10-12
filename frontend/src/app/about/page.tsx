import { EchoAgeShell } from "@/components/brand/echo-age";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { PillarsSection } from "@/components/landing/sections/pillars-section";

export default function AboutPage() {
  return (
    <EchoAgeShell className="echo-age-landing" cosmos={{ fixed: true }}>
      <Header />
      <main className="relative z-10 flex w-full flex-col">
        <Hero />
        <PillarsSection />
      </main>
      <Footer />
    </EchoAgeShell>
  );
}
