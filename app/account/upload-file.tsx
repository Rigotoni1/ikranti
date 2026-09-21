"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";

export function UploadFile() {
  const input=useRef<HTMLInputElement>(null);
  const [file,setFile]=useState<File|null>(null);
  const [preview,setPreview]=useState("");
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  return <div className="uploadSelection">
    <label>File<input ref={input} type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={e=>{const next=e.target.files?.[0]||null;setPreview(next?.type.startsWith("image/")?URL.createObjectURL(next):"");setFile(next);}}/></label>
    {file&&<><p>{file.name} · {Math.ceil(file.size/1024)} KB · Not uploaded yet</p>
      {preview&&<Image unoptimized width={280} height={180} src={preview} alt="Selected upload preview" style={{objectFit:"contain"}}/>}
      <div className="portalLinks"><button type="button" onClick={()=>input.current?.click()}>Replace selected file</button><button type="button" onClick={()=>{if(input.current)input.current.value="";setFile(null);setPreview("");}}>Remove selected file</button></div>
    </>}
  </div>;
}
