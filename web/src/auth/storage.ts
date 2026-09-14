import type{AuthState}from'../types';const KEY='codeeval-auth'
export function loadAuth():AuthState|null{try{const auth=JSON.parse(localStorage.getItem(KEY)??'null');return auth?.token&&['teacher','student'].includes(auth.user?.role)?auth:null}catch{return null}}
export const saveAuth=(auth:AuthState)=>localStorage.setItem(KEY,JSON.stringify(auth))
export const clearAuth=()=>localStorage.removeItem(KEY)
