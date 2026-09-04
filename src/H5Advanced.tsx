import { App as H5WebApp } from "@h5web/app";
import { H5WasmLocalFileProvider } from "@h5web/h5wasm";
import "@h5web/app/styles.css";

export default function H5Advanced({ file }: { file: File }) {
  return <H5WasmLocalFileProvider file={file}><H5WebApp /></H5WasmLocalFileProvider>;
}
