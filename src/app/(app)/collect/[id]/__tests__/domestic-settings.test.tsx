// @vitest-environment jsdom
import { afterEach,describe,it,expect,vi } from "vitest";
import { cleanup,fireEvent,render } from "@testing-library/react";
import { DomesticBuilderSettings } from "../DomesticBuilderSettings";
import { createDomesticFormConfig } from "@/lib/collect-builder-type";
vi.mock("@/lib/app-url",()=>({getPublicAppOrigin:()=>"https://machstudio.vercel.app"}));
afterEach(cleanup);
describe("domestic settings",()=>{
  it("follows updated server settings instead of displaying a stale prefix",()=>{
    const config=createDomesticFormConfig(),patch=vi.fn();
    const view=render(<DomesticBuilderSettings config={config} patch={patch} sourceId="source"/>);
    view.rerender(<DomesticBuilderSettings config={{...config,registrationPrefix:"75"}} patch={patch} sourceId="source"/>);
    expect((view.getByLabelText("등록번호 접두번호") as HTMLInputElement).value).toBe("75");
    expect(view.getByText("75000001 → 75999999")).toBeTruthy();
  });
  it("keeps partial prefixes out of saved configuration and normalizes at input",()=>{
    const patch=vi.fn(),view=render(<DomesticBuilderSettings config={createDomesticFormConfig()} patch={patch} sourceId="source"/>);
    const input=view.getByLabelText("등록번호 접두번호");
    fireEvent.change(input,{target:{value:"9"}});
    expect(patch).not.toHaveBeenCalled();expect(view.getByRole("alert").textContent).toContain("숫자 2자리");
    fireEvent.change(input,{target:{value:"a07"}});
    expect(patch).toHaveBeenLastCalledWith({registrationPrefix:"07"});
  });
});
