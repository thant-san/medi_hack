from __future__ import annotations

import argparse
import math
import os
import re
from pathlib import Path
from datetime import datetime
from typing import Any

import pandas as pd
from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()


def chunked(items: list[dict[str, Any]], size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def parse_datetime(value: Any) -> str:
    if pd.isna(value):
        return datetime.utcnow().isoformat()
    if isinstance(value, datetime):
        return value.isoformat()
    parsed = pd.to_datetime(value, errors='coerce')
    if pd.isna(parsed):
        return datetime.utcnow().isoformat()
    return parsed.to_pydatetime().isoformat()


def clean_num(value: Any) -> float | None:
    if pd.isna(value):
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if math.isfinite(n):
        return n
    return None


def clean_int(value: Any) -> int | None:
    num = clean_num(value)
    if num is None:
        return None
    return int(round(num))


def normalize_column_name(name: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', str(name).strip().lower()).strip('_')


def clean_cell_value(value: Any) -> Any:
    if pd.isna(value):
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, 'isoformat') and not isinstance(value, (str, bytes)):
        try:
            return value.isoformat()
        except Exception:
            pass
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            return None
        return value
    return str(value).strip()


def parse_bp(value: Any) -> tuple[int | None, int | None]:
    if pd.isna(value):
        return None, None
    text = str(value).strip()
    match = re.match(r'^(\d{2,3})\s*/\s*(\d{2,3})$', text)
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def main() -> None:
    parser = argparse.ArgumentParser(description='Import screening CSV/Excel subset into Supabase')
    parser.add_argument('--file', required=True, help='Path to CSV or Excel file')
    parser.add_argument('--sheet', default=0, help='Sheet name or index')
    parser.add_argument('--limit', type=int, default=1000, help='Max rows to import for demo')
    args = parser.parse_args()

    url = os.getenv('SUPABASE_URL')
    key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        raise RuntimeError('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')

    sb: Client = create_client(url, key)

    file_path = Path(args.file)
    ext = file_path.suffix.lower()

    if ext == '.csv':
        df = pd.read_csv(args.file, encoding='utf-8-sig')
    elif ext in ('.xlsx', '.xlsm', '.xls'):
        df = pd.read_excel(args.file, sheet_name=args.sheet)
    else:
        raise RuntimeError('Unsupported file type. Use .csv, .xlsx, .xlsm, or .xls')

    df.columns = [normalize_column_name(c) for c in df.columns]

    col_map = {
        'hnx': ['hnx', 'hn', 'hospital_number'],
        'modify_time': ['modify_time', 'modify_ti', 'modified_time', 'screen_time', 'visit_time', 'datetime'],
        'spid': ['spid', 'measure_spid', 'clinic', 'service_point'],
        'weight': ['weight', 'wt'],
        'height': ['height', 'ht'],
        'bmi': ['bmi'],
        'sbp': ['sbp', 'systolic'],
        'dbp': ['dbp', 'diastolic'],
        'bp': ['bp', 'b_p'],
        'chief_complaint': ['chief_complaint', 'chief_complaints', 'nurse_chief_complaint', 'cc'],
        'illness_detail': ['illness_detail', 'nurse_patient_illness', 'detail'],
    }

    resolved: dict[str, str] = {}
    for target, candidates in col_map.items():
        found = next((c for c in candidates if c in df.columns), None)
        if found:
            resolved[target] = found

    required = ['hnx', 'modify_time', 'spid']
    missing = [r for r in required if r not in resolved]
    if missing:
        raise RuntimeError(f'Missing required columns in excel: {missing}')

    subset = df.head(args.limit).copy()
    subset = subset[subset[resolved['hnx']].notna()]

    unique_hnx = sorted({str(v).strip() for v in subset[resolved['hnx']].tolist() if str(v).strip()})

    print(f'Upserting patients: {len(unique_hnx)}')
    for batch in chunked([{'hnx': h} for h in unique_hnx], 500):
        sb.table('patients').upsert(batch, on_conflict='hnx').execute()

    patient_rows = sb.table('patients').select('id,hnx').in_('hnx', unique_hnx).execute().data or []
    patient_by_hnx = {row['hnx']: row['id'] for row in patient_rows}

    inserts: list[dict[str, Any]] = []
    for _, row in subset.iterrows():
        hnx = str(row[resolved['hnx']]).strip()
        patient_id = patient_by_hnx.get(hnx)
        if not patient_id:
            continue

        sbp = clean_int(row[resolved['sbp']]) if 'sbp' in resolved else None
        dbp = clean_int(row[resolved['dbp']]) if 'dbp' in resolved else None
        if (sbp is None or dbp is None) and 'bp' in resolved:
            parsed_sbp, parsed_dbp = parse_bp(row[resolved['bp']])
            if sbp is None:
                sbp = parsed_sbp
            if dbp is None:
                dbp = parsed_dbp

        raw_payload = {
            col: clean_cell_value(val)
            for col, val in row.to_dict().items()
        }

        record = {
            'patient_id': patient_id,
            'hnx': hnx,
            'modify_time': parse_datetime(row[resolved['modify_time']]),
            'spid': str(row[resolved['spid']]).strip() or 'MED',
            'weight': clean_num(row[resolved['weight']]) if 'weight' in resolved else None,
            'height': clean_num(row[resolved['height']]) if 'height' in resolved else None,
            'bmi': clean_num(row[resolved['bmi']]) if 'bmi' in resolved else None,
            'sbp': sbp,
            'dbp': dbp,
            'chief_complaint': str(row[resolved['chief_complaint']]).strip() if 'chief_complaint' in resolved and pd.notna(row[resolved['chief_complaint']]) else None,
            'illness_detail': str(row[resolved['illness_detail']]).strip() if 'illness_detail' in resolved and pd.notna(row[resolved['illness_detail']]) else None,
            'raw_payload': raw_payload,
            'source': 'import',
        }
        inserts.append(record)

    print(f'Inserting screening records: {len(inserts)}')
    for batch in chunked(inserts, 500):
        sb.table('screening_records').insert(batch).execute()

    print('Import completed.')


if __name__ == '__main__':
    main()
