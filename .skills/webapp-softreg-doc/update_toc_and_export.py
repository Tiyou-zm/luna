from __future__ import annotations

import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Update Word TOC and export PDF using local Microsoft Word.")
    parser.add_argument("--input", required=True, help="Input DOCX path")
    parser.add_argument("--pdf", help="Optional output PDF path")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    pdf_path = Path(args.pdf).resolve() if args.pdf else None

    import win32com.client  # type: ignore

    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    doc = None

    try:
        doc = word.Documents.Open(str(input_path))
        for toc in doc.TablesOfContents:
            toc.Update()
        doc.Fields.Update()
        doc.Save()
        if pdf_path:
            doc.ExportAsFixedFormat(str(pdf_path), 17)
    finally:
        if doc is not None:
            doc.Close(False)
        try:
            word.Quit()
        except Exception:
            pass


if __name__ == "__main__":
    main()
