import { expect, it } from "vitest";
import { parseNaverApiNews } from "../collect";

it("converts NAVER API HUB news to a source result", () => {
  expect(parseNaverApiNews({ items: [{
    title: "<b>Korea Expo</b> opening",
    originallink: "https://news.example.com/a",
    description: "event <b>news</b>",
    pubDate: "Thu, 29 Oct 2026 10:00:00 +0900",
  }] })).toMatchObject([{
    title: "Korea Expo opening",
    url: "https://news.example.com/a",
    source: "news.example.com",
    excerpt: "event news",
    origin: "naver-api",
  }]);
});
