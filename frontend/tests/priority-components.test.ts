import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { defineComponent, h } from 'vue'
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('axios', () => ({ default: { create: () => ({ get:api.get,post:api.post,interceptors:{request:{use:vi.fn()},response:{use:vi.fn()}} }) } }))
import Messages from '@/views/Messages.vue'
import MessageDetailModal from '@/components/MessageDetailModal.vue'
import MessageFilters from '@/components/MessageFilters.vue'
import i18n from '@/locales'
import { useAlertProvider } from '@/composables/useAlert'
import { useConfirmDialogProvider } from '@/composables/useConfirmDialog'

const rows = [-1,0,1,2,3,5,10].map((priority,id) => ({id:id+1,appid:id===5?2:1,title:`notice ${priority}`,message:`body ${priority}`,date:'2026-10-14T00:00:00Z',priority}))
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); window.history.replaceState({},'', '/');i18n.global.locale.value='en-US'
  api.get.mockImplementation((url:string) => Promise.resolve({data:url.startsWith('/message')?{messages:rows,paging:{size:7,limit:100,since:0}}:[{id:1,name:'App 1'},{id:2,name:'App 2'}]}))
})
function mountWithProviders(component:any,props:Record<string,unknown>={}) {
  const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:defineComponent({render:()=>h('div')})}]})
  const Provider=defineComponent({setup(){useAlertProvider();useConfirmDialogProvider();return()=>h(component,props)}})
  return mount(Provider,{global:{plugins:[createPinia(),router,i18n],stubs:{Layout:{template:'<div><slot /></div>'},Teleport:true}}})
}
describe('priority UI integration',()=>{
  it.each([[-1,0,'Low'],[5,3,'Emergency'],[undefined,1,'Normal']])('detail priority %s has consistent label and style',async(priority,level,label)=>{
    const wrapper=mountWithProviders(MessageDetailModal,{message:{...rows[0],appid:0,priority}})
    await flushPromises();const badge=wrapper.find('.message-priority');expect(badge.classes()).toContain(`priority-${level}`);expect(badge.text()).toBe(label);wrapper.unmount()
  })
  it('urgent and low filters include out-of-range values; app and search compose',async()=>{
    const wrapper=mountWithProviders(Messages);await flushPromises()
    const priority=wrapper.find('#priority-filter');await priority.setValue('3')
    expect(wrapper.findAll('.message-priority').map(x=>x.text())).toEqual(['Emergency','Emergency','Emergency'])
    await wrapper.find('#application-filter').setValue('2');expect(wrapper.findAll('.message-priority')).toHaveLength(1);expect(wrapper.text()).toContain('notice 5')
    await wrapper.find('#application-filter').setValue('');await priority.setValue('0');expect(wrapper.findAll('.message-priority').map(x=>x.text())).toEqual(['Low','Low'])
    await wrapper.find('#search-filter').setValue('body -1');await new Promise(resolve=>setTimeout(resolve,350));await flushPromises();expect(wrapper.findAll('.message-priority')).toHaveLength(1);wrapper.unmount()
  })
  it.each([['5','3'],['-1','0'],['abc',''],['9007199254740992',''],['','']])('URL priority %s normalizes to %s',async(raw,want)=>{
    window.history.replaceState({},'',`/?priority=${raw}`);const wrapper=mount(MessageFilters,{props:{applications:[]},global:{plugins:[i18n]}});await flushPromises()
    expect((wrapper.find('#priority-filter').element as HTMLSelectElement).value).toBe(want);expect(wrapper.emitted('change')?.[0]?.[0]).toMatchObject({priority:want});wrapper.unmount()
  })
})
