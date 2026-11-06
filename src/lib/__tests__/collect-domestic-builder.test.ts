import { describe, it, expect } from "vitest";
import { createDomesticFormConfig } from "../collect-builder-type";
import { domesticRegistrationNo, extractRegistrationNo, isValidRegistrationNo } from "../collect-registration-no";
import { mergeFormConfigUpdate, normalizeCollectForm, visibleFields } from "../collect-form-config";
import { prepareBuilderSubmission } from "../collect-submit";
import { buildLookupView } from "../collect-lookup";
describe("domestic builder",()=>{
  it("formats configurable prefixes and rejects overflow",()=>{
    expect(domesticRegistrationNo("90",1)).toBe("90000001");
    expect(domesticRegistrationNo("07",42)).toBe("07000042");
    expect(()=>domesticRegistrationNo("90",1000000)).toThrow();
    expect(isValidRegistrationNo("90000000")).toBe(false);
    expect(extractRegistrationNo("https://x/t/90000001?key=x")).toBe("90000001");
    expect(extractRegistrationNo("1900000010")).toBeNull();
  });
  it("keeps existing builders international and preserves domestic identity in partial saves",()=>{
    expect(normalizeCollectForm({}).builderVariant).toBe("international");
    const config={...createDomesticFormConfig(),registrationPrefix:"75"};
    expect(mergeFormConfigUpdate(config,{fields:config.fields},undefined)).toMatchObject({builderVariant:"domestic",registrationPrefix:"75"});
  });
  it("validates tab-specific fields server-side and stores the selected type",()=>{
    const config=createDomesticFormConfig();
    const values={name:"김등록",email:"visitor@example.com",phone:"01012345678",visitor_type:"일반 사전등록"};
    const input={values,consent:{privacy:true}};
    const general=prepareBuilderSubmission(config,input,new Date());
    expect(general.ok).toBe(true);
    if(general.ok) expect(general.prepared.data.visitor_type).toBe("일반 사전등록");
    expect(prepareBuilderSubmission(config,{...input,values:{...values,visitor_type:"바이어"}},new Date()).ok).toBe(false);
    expect(visibleFields(config,values).some(f=>f.key==="company")).toBe(false);
    expect(visibleFields(config,{...values,visitor_type:"바이어"}).some(f=>f.key==="company")).toBe(true);
  });
  it("issues ticket access keys only after identity lookup and only with QR enabled",()=>{
    const config=createDomesticFormConfig(); const record={id:"secret-record-id",registrationNo:"90000001",data:{name:"김등록"}};
    expect(buildLookupView({...config,lookup:{...config.lookup,showQr:true}},record)).toMatchObject({ticketKey:record.id});
    expect(buildLookupView({...config,lookup:{...config.lookup,showQr:false}},record)).not.toHaveProperty("ticketKey");
  });
});
