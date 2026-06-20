# Global Badge Number Registry

Badges can be generated from WhatsApp or from the web flow, but badge numbers must remain globally unique and ordered across both origins. We will use a canonical badge number registry instead of letting each origin allocate numbers independently, because concurrent WhatsApp and web generation would otherwise risk collisions or duplicated allocation logic.
