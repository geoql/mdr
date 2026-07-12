<script setup lang="ts">
  defineProps<{
    kicker: string;
    headlineA: string;
    headlineBItalic: string;
    headlineC: string;
    lede: string;
    ledeStrong: string;
    installSnippet: string;
    ctaPrimary: { label: string; href: string };
    ctaSecondary: { label: string; href: string };
  }>();
</script>

<template>
  <section
    class="hero relative w-full flex items-center overflow-hidden min-h-dvh"
    :style="`
      background:
        radial-gradient(
          1100px 540px at 78% -8%,
          color-mix(in oklch, var(--accent) 14%, transparent),
          transparent 60%
        ),
        radial-gradient(
          900px 480px at 8% 110%,
          color-mix(in oklch, var(--accent-deep) 10%, transparent),
          transparent 60%
        ),
        var(--bg);
    `"
  >
    <div
      aria-hidden="true"
      class="absolute inset-0 dot-grid opacity-50 pointer-events-none"
      :style="`
        -webkit-mask-image: linear-gradient(180deg, oklch(0 0 0) 0%, oklch(0 0 0 / 0.4) 60%, transparent 100%);
        mask-image: linear-gradient(180deg, oklch(0 0 0) 0%, oklch(0 0 0 / 0.4) 60%, transparent 100%);
      `"
    />

    <div
      class="relative z-1 mx-auto max-w-330 w-full grid grid-cols-1 lg:grid-cols-[7fr_5fr] gap-x-14 gap-y-12 items-center px-5 lg:px-8 pt-24 pb-20 lg:py-24"
    >
      <div>
        <span
          class="kicker inline-flex items-center gap-2.5 font-mono text-[11.5px] tracking-[0.14em] uppercase text-ink-muted px-2.5 py-1.5 border border-border rounded-sm"
          :style="`background: color-mix(in oklch, var(--surface) 70%, transparent);`"
        >
          <span
            class="size-1.5 rounded-full bg-accent"
            :style="`box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 22%, transparent);`"
          />
          {{ kicker }}
        </span>

        <h1
          class="font-display font-400 text-ink leading-[0.98] tracking-tighter my-5 text-[clamp(46px,7vw,86px)]"
        >
          <span class="block">{{ headlineA }}</span>
          <span class="block italic text-accent" style="margin-left: -0.04em">{{
            headlineBItalic
          }}</span>
          <span class="block">{{ headlineC }}</span>
        </h1>

        <p
          class="text-[clamp(17px,1.5vw,20px)] leading-[1.55] text-ink-muted max-w-[58ch] mt-0 mb-8"
        >
          {{ lede }}
          <strong class="text-ink font-medium">{{ ledeStrong }}</strong
          >. Plain markdown and JSON on disk — nothing phones home, the whole
          system runs inside your existing agent permissions.
        </p>

        <div
          class="cli flex items-center gap-0 bg-surface border border-border rounded-md py-1.5 pl-3.5 pr-1.5 max-w-140 transition-colors duration-200 focus-within:border-ink-muted"
          role="group"
          aria-label="Install snippet"
        >
          <span class="text-ink-dim font-mono text-[13.5px] mr-2 select-none"
            >$</span
          >
          <code class="font-mono text-[14px] text-ink flex-1 min-w-0 truncate">
            {{ installSnippet }}
          </code>
          <CopyButton
            :text="installSnippet"
            label="Copy"
            success-label="Copied"
          />
        </div>

        <div class="flex items-center gap-3.5 flex-wrap mt-4">
          <a
            :href="ctaPrimary.href"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 px-5 h-11 rounded-md bg-accent text-ink-on-accent font-medium text-[14.5px] tracking-[-0.01em] hover:brightness-105 transition-[filter] duration-120"
          >
            {{ ctaPrimary.label }}
            <Icon name="lucide:arrow-right" class="size-3.5" />
          </a>
          <a
            :href="ctaSecondary.href"
            class="inline-flex items-center gap-2 px-4 h-11 rounded-md border border-border bg-surface text-ink text-[14.5px] tracking-[-0.01em] hover:text-ink hover:border-ink-muted transition-colors duration-120"
          >
            {{ ctaSecondary.label }}
            <Icon name="lucide:arrow-right" class="size-3.5" />
          </a>
        </div>
      </div>

      <div
        class="relative aspect-5/4 rounded-lg border border-border bg-surface overflow-hidden"
      >
        <div class="absolute inset-0 dot-grid opacity-50 pointer-events-none" />
        <div class="relative h-full p-5 flex flex-col gap-3">
          <div
            class="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-dim"
          >
            <span>BIN · 0xA7 · TICK 08104</span>
            <span class="flex items-center gap-1.5">
              <span
                class="size-1.5 rounded-full bg-accent"
                :style="`box-shadow: 0 0 0 3px color-mix(in oklch, var(--accent) 25%, transparent);`"
              />
              REFINING
            </span>
          </div>

          <div class="data-grid mt-2 grow content-start">
            <span :style="`--i: 0`">8.3714</span>
            <span :style="`--i: 1`">2.9147</span>
            <span :style="`--i: 2`">5.6082</span>
            <span :style="`--i: 3`">1.2453</span>
            <span :style="`--i: 4`">9.0008</span>
            <span :style="`--i: 5`">0.7716</span>
            <span :style="`--i: 6`">7.4892</span>
            <span :style="`--i: 7`">3.0058</span>

            <span :style="`--i: 8`">4.2209</span>
            <span :style="`--i: 9`">6.8513</span>
            <span :style="`--i: 10`">2.1370</span>
            <span :style="`--i: 11`">8.9645</span>
            <span :style="`--i: 12`">1.5072</span>
            <span :style="`--i: 13`">0.6804</span>
            <span :style="`--i: 14`">5.3391</span>
            <span :style="`--i: 15`">9.7268</span>

            <span :style="`--i: 16`">3.4188</span>
            <span :style="`--i: 17`">7.2056</span>
            <span :style="`--i: 18`">1.8924</span>
            <span :style="`--i: 19`">4.0671</span>
            <span :style="`--i: 20`">2.5517</span>
            <span :style="`--i: 21`">6.7349</span>
            <span :style="`--i: 22`">0.3207</span>
            <span :style="`--i: 23`">8.1083</span>

            <span :style="`--i: 24`">5.0061</span>
            <span :style="`--i: 25`">9.5494</span>
            <span :style="`--i: 26`">4.4278</span>
            <span :style="`--i: 27`">7.8622</span>
            <span :style="`--i: 28`">1.1149</span>
            <span :style="`--i: 29`">3.7806</span>
            <span :style="`--i: 30`">2.6384</span>
            <span :style="`--i: 31`">6.2950</span>

            <span :style="`--i: 32`">0.4427</span>
            <span :style="`--i: 33`">5.1819</span>
            <span :style="`--i: 34`">8.7150</span>
            <span :style="`--i: 35`">3.9462</span>
            <span :style="`--i: 36`">9.2783</span>
            <span :style="`--i: 37`">1.6508</span>
            <span :style="`--i: 38`">7.0231</span>
            <span :style="`--i: 39`">4.8667</span>

            <span :style="`--i: 40`" class="refined">.08</span>
            <span :style="`--i: 41`" class="refined">.15</span>
            <span :style="`--i: 42`" class="refined">.04</span>
            <span :style="`--i: 43`" class="refined">.02</span>
            <span :style="`--i: 44`" class="refined">.19</span>
            <span :style="`--i: 45`" class="refined">.07</span>
            <span :style="`--i: 46`" class="refined">.11</span>
            <span :style="`--i: 47`" class="refined">.06</span>
          </div>

          <div
            class="mt-auto flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-dim"
          >
            <span>→ refined · 12.4ms</span>
            <span>48 / 48</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
