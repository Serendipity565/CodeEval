import{apiRequest}from'./client';import type{AuthState}from'../types'
export async function login(username:string,password:string):Promise<AuthState>{const data=await apiRequest<{accessToken:string;user:AuthState['user']}>('/auth/login','',{method:'POST',body:JSON.stringify({username,password})});return{token:data.accessToken,user:data.user}}
