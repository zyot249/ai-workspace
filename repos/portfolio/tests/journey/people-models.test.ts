// tests/journey/people-models.test.ts
import { describe, expect, it } from 'vitest'
import { disposePeopleModels, loadPeopleModels, type PeopleGltfSource } from '../../app/journey/people-models'
import { CHARACTER_SPECS, PEOPLE_CLIPS, PEOPLE_MODEL_DIR } from '../../app/journey/people-specs'
import { fakeClips, fakeRigScene } from './support/fake-rig'

const goodSource: PeopleGltfSource = async () => ({ scene: fakeRigScene(), animations: fakeClips() })

describe('loadPeopleModels', () => {
  it('builds one template per character from the model directory', async () => {
    const urls: string[] = []
    const models = await loadPeopleModels(async url => { urls.push(url); return goodSource(url) })
    expect(urls.sort()).toEqual(CHARACTER_SPECS.map(spec => PEOPLE_MODEL_DIR + spec.file).sort())
    expect(models.templates).toHaveLength(CHARACTER_SPECS.length)
    disposePeopleModels(models)
  })

  it('rejects when a download fails', async () => {
    const source: PeopleGltfSource = async url => {
      if (url.endsWith(CHARACTER_SPECS[1]!.file)) throw new Error('404')
      return goodSource(url)
    }
    await expect(loadPeopleModels(source)).rejects.toThrow('404')
  })

  it('rejects, naming the clip, when a model lacks one', async () => {
    const source: PeopleGltfSource = async () => ({
      scene: fakeRigScene(), animations: fakeClips().filter(clip => clip.name !== PEOPLE_CLIPS.walk),
    })
    await expect(loadPeopleModels(source)).rejects.toThrow(new RegExp(`"${PEOPLE_CLIPS.walk}"`))
  })

  it('rejects when only the last model is bad, after the earlier templates were built', async () => {
    let call = 0
    const source: PeopleGltfSource = async () => {
      call += 1
      return { scene: fakeRigScene(), animations: call === CHARACTER_SPECS.length ? [] : fakeClips() }
    }
    await expect(loadPeopleModels(source)).rejects.toThrow(/clip/)
  })
})
