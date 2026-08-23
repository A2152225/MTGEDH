from pathlib import Path
p = Path(r'D:/Git/MTGEDH/server/src/state/modules/oracleIrServerZoneSync.ts')
text = p.read_text(encoding='utf-8')
# In any_player_may queue block, remove optionalPaymentLifeAmount and set validation kind carefully
old = '''        optionalPaymentPrompt: true,
        optionalPaymentValidationKind:
          payment?.kind === 'life' || payment?.kind === 'half_life_rounded_up'
            ? 'life'
            : payment?.kind === 'discard'
              ? 'discard'
              : payment?.kind === 'sacrifice'
                ? 'sacrifice'
                : 'life',
        optionalPaymentLifeAmount:
          payment?.kind === 'life'
            ? payment.amount
            : undefined,
        optionalPaymentPayChoiceId: 'pay','''

new = '''        optionalPaymentPrompt: true,
        // Payment is applied by evaluateAnyPlayerMayStep on resume (avoid double-charge).
        optionalPaymentValidationKind: 'none',
        optionalPaymentPayChoiceId: 'pay','''

if old not in text:
    # show nearby
    i = text.find('oracleIrAnyPlayerMayChoice: true')
    print(text[i-600:i+200])
    raise SystemExit('queue payment block not found')
text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
print('avoided double life charge')
