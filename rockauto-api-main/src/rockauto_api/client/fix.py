import re
import sys

def fix_client():
    path = r"c:\Apps\zempel-autoparts-crm\zempel-autoparts-crm\rockauto-api-main\src\rockauto_api\client\client.py"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Fix hrefs
    content = content.replace('href = link.get("href", "")', 'href = str(link.get("href", ""))')
    
    # Fix option values
    content = content.replace('value = option.get("value", "")', 'value = str(option.get("value", ""))')
    
    # Fix regex search
    content = re.sub(
        r'match = pattern\.search\(([\w_]+)\.strip\(\)\)',
        r'match = pattern.search(str(\1).strip())',
        content
    )
    
    # Fix tracking match lower
    content = content.replace('"ups" in tracking_match.lower()', '"ups" in str(tracking_match).lower()')
    content = content.replace('"fedex" in tracking_match.lower()', '"fedex" in str(tracking_match).lower()')
    content = content.replace('"usps" in tracking_match.lower()', '"usps" in str(tracking_match).lower()')

    # Fix PartInfo creation line 1298
    content = content.replace('''            return PartInfo(
                part_number=part_number,
                brand="Unknown",
                price="Unknown",
                description="Unknown",
                href=href,
                specifications={}
            )''', '''            return PartInfo(
                name="Unknown Part",
                part_number=part_number,
                brand="Unknown",
                price="Unknown",
                url=href,
                specifications=None
            )''')
            
    # Fix "AttributeValueList | str is not assignable to TypedDict key _nck" line 1960
    content = content.replace('form_data["_nck"] = security_token', 'form_data["_nck"] = str(security_token)')

    # Fix "Returned type ResultSet[Tag] | Unknown is not assignable to str" line 1863
    content = content.replace('return error_text.strip()', 'return str(error_text).strip()')

    # Fix "Returned type BillingInfo | bool | Unknown is not assignable to bool" line 1910
    content = content.replace('item_count > 0 or has_billing or', 'bool(item_count > 0 or has_billing or')
    content = content.replace('(len(str(status)) < 100 and status.lower() not in [\'unknown\', \'\'])\n        )', '(len(str(status)) < 100 and status.lower() not in [\'unknown\', \'\']))\n        )')
    
    # Fix "str | Unknown | None is not assignable to part_number" in line 901
    content = content.replace('part_number=tool_info["part_number"],', 'part_number=str(tool_info["part_number"]),')

    # Fix "Argument AttributeValueList | str | None is not assignable to href" in Engine/PartCategory/ToolCategory
    # Wait, the Engine/PartCategory ones are passed directly like `href=href,`. It's fine since we cast `href = str(...)` earlier.

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    fix_client()
