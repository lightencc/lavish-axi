// Run with the browser evaluate-script tool as a function, on a separate test tab.
() => {
  const select = (start, end, release) => {
    document.getElementById("close").click();
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.textContent.length);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const expected = selection.toString().trim();
    release.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 300, clientY: 300 }));
    if (document.getElementById("popover").hidden) throw new Error(`Selection did not open comment: ${expected}`);
    if (document.getElementById("quote").textContent !== expected) throw new Error("Comment lost selected text");
  };
  const heading = document.querySelector("#conversation h2").lastChild;
  select(heading, heading, heading.parentElement);
  const first = document.querySelector("#select-behavior p:first-child").firstChild;
  const last = document.querySelector("#select-behavior p:last-child").firstChild;
  select(first, last, document.querySelector("main"));
  const metadata = document.querySelector(".meta span:nth-child(2)").firstChild;
  select(metadata, metadata, document.body);
  document.getElementById("close").click();
  getSelection().removeAllRanges();
  for (const control of document.querySelectorAll(
    "#confirmation-form input,#confirmation-form textarea,#confirmation-form label",
  )) {
    control.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 300, clientY: 300 }));
    if (!document.getElementById("popover").hidden) throw new Error("Form interaction opened a comment");
  }
  return {
    passed: [
      "chapter heading",
      "multiple paragraphs / release outside block",
      "unmarked document text / release outside main",
      "native form controls stay interactive",
    ],
  };
};
