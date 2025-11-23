/**
 * Rule 701.3: Attach
 * 
 * To attach an Aura, Equipment, or Fortification to an object or player means
 * to take it from where it currently is and put it onto that object or player.
 */

export interface AttachAction {
  readonly type: 'attach';
  readonly attachmentId: string; // Aura, Equipment, or Fortification
  readonly targetId: string; // Object or player to attach to
}

export interface AttachmentState {
  readonly id: string;
  readonly attachedTo: string | null;
  readonly timestamp: number; // Rule 701.3c: New timestamp on reattachment
}

/**
 * Rule 701.3a: Attachment validation
 */
export function canAttachTo(
  attachment: { id: string; type: 'aura' | 'equipment' | 'fortification' },
  target: { id: string; type: string }
): boolean {
  // Auras must be able to enchant the target
  // Equipment must be able to equip the target
  // Fortifications must be able to fortify the target
  return true; // Simplified - full validation requires enchant/equip/fortify rules
}

/**
 * Rule 701.3a: Perform attachment
 * Rule 701.3c: Attaching gives new timestamp
 */
export function attachToObject(
  attachment: AttachmentState,
  targetId: string,
  timestamp: number
): AttachmentState {
  return {
    ...attachment,
    attachedTo: targetId,
    timestamp, // Rule 701.3c
  };
}

/**
 * Rule 701.3b: Invalid attachment attempts
 */
export function attemptAttach(
  attachment: AttachmentState,
  targetId: string,
  timestamp: number
): AttachmentState {
  // If already attached to this target, effect does nothing
  if (attachment.attachedTo === targetId) {
    return attachment;
  }
  
  // If can't attach, doesn't move
  // Simplified - would check canAttachTo in full implementation
  
  return attachToObject(attachment, targetId, timestamp);
}

/**
 * Rule 701.3d: Unattach
 * 
 * To "unattach" an Equipment from a creature means to move it away from that creature
 * so the Equipment is on the battlefield but is not equipping anything.
 */
export function unattach(attachment: AttachmentState): AttachmentState {
  return {
    ...attachment,
    attachedTo: null,
  };
}

export function isAttached(attachment: AttachmentState): boolean {
  return attachment.attachedTo !== null;
}
