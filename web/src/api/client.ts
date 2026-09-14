const API_BASE_URL=import.meta.env.VITE_API_BASE_URL??'http://localhost:8080/api/v1'
export class ApiError extends Error{constructor(message:string,readonly status:number){super(message);this.name='ApiError'}}
export async function apiRequest<T=any>(path:string,token='',options?:RequestInit):Promise<T>{
  const response=await fetch(`${API_BASE_URL}${path}`,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options?.headers??{})}})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new ApiError(data.error??'请求失败',response.status)
  return data as T
}
