<script setup lang="ts">
import { siteConfig } from '~~/site.config'

const { data: featured } = await useAsyncData('home-featured-projects', () =>
  queryCollection('projects').where('featured', '=', true).all()
)

const { data: about } = await useAsyncData('home-about-teaser', () =>
  queryCollection('about').first()
)

useSeoMeta({
  title: siteConfig.tagline,
  description: siteConfig.tagline,
})

const { isDark } = useDarkMode()
const { chapter, progress } = useJourneyProgress()
const sceneAvailable = ref(true)

const panel = 'rounded-2xl p-6 md:p-8 md:max-w-2xl bg-white/75 dark:bg-neutral-950/60 backdrop-blur border border-neutral-200/70 dark:border-white/10 shadow-sm'
</script>

<template>
  <div>
    <JourneyCanvas
      :chapter="chapter"
      :progress="progress"
      :is-dark="isDark"
      @unavailable="sceneAvailable = false"
    />

    <div class="relative z-10">
      <JourneyChapter chapter="intro">
        <Hero :transparent="sceneAvailable" class="flex-1 flex flex-col justify-center" />
      </JourneyChapter>

      <JourneyChapter chapter="projects">
        <div class="px-6 py-16 w-full max-w-5xl mx-auto">
          <div :class="[panel, 'md:ml-auto']">
            <h2 class="text-2xl font-bold mb-6">Featured Projects</h2>
            <div v-if="featured?.length" class="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <ProjectCard
                v-for="project in featured"
                :key="project.path"
                :project="{
                  title: project.title,
                  description: project.description,
                  stack: project.stack,
                  path: project.path,
                  cover: project.cover,
                }"
              />
            </div>
            <p v-else class="text-neutral-500 dark:text-neutral-400">No projects yet.</p>
            <NuxtLink to="/projects" class="inline-block mt-6 text-indigo-600 dark:text-indigo-400 font-medium">
              See all projects &rarr;
            </NuxtLink>
          </div>
        </div>
      </JourneyChapter>

      <JourneyChapter chapter="skills">
        <div class="px-6 py-16 w-full max-w-5xl mx-auto">
          <div :class="[panel, 'md:mr-auto']">
            <h2 class="text-2xl font-bold mb-6">Skills</h2>
            <div v-for="group in siteConfig.skills" :key="group.category" class="mb-6">
              <h3 class="text-sm font-semibold uppercase text-neutral-500 mb-2">{{ group.category }}</h3>
              <div class="flex flex-wrap gap-2">
                <SkillBadge v-for="item in group.items" :key="item" :label="item" />
              </div>
            </div>
          </div>
        </div>
      </JourneyChapter>

      <JourneyChapter chapter="about">
        <div class="px-6 py-16 w-full max-w-5xl mx-auto">
          <div :class="[panel, 'md:ml-auto']">
            <h2 class="text-2xl font-bold mb-4">About</h2>
            <p v-if="about" class="text-neutral-600 dark:text-neutral-400">{{ about.title }}</p>
            <div class="mt-4 flex flex-wrap gap-6">
              <NuxtLink to="/about" class="text-indigo-600 dark:text-indigo-400 font-medium">
                Read more about me &rarr;
              </NuxtLink>
              <a
                :href="siteConfig.resumeUrl"
                :target="siteConfig.resumeUrl.startsWith('http') ? '_blank' : undefined"
                :rel="siteConfig.resumeUrl.startsWith('http') ? 'noopener' : undefined"
                class="text-indigo-600 dark:text-indigo-400 font-medium"
              >
                Resume &rarr;
              </a>
            </div>
          </div>
        </div>
      </JourneyChapter>
    </div>
  </div>
</template>
