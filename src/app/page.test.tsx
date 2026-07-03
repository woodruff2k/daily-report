import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("renders the project title", () => {
    render(<Home />);
    expect(
      screen.getByText("영업 일일 보고 시스템")
    ).toBeInTheDocument();
  });
});
