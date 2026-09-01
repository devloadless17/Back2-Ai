import { redirect } from 'next/navigation';

/**
 * Folded into the tutor.
 *
 * This was a page of its own: photograph a question, correct the transcription,
 * and it created a conversation for you. The chat composer now takes the photo
 * directly and keeps the same editable transcription step, so the separate page
 * only offered a second door into one room — and made a student choose between
 * two nav entries before they could know the two were the same thing.
 *
 * Kept as a redirect rather than deleted: the route has been linked from a
 * dashboard card and may sit in a bookmark or a message to a classmate, and a
 * 404 is a worse answer than the place they were trying to get to.
 */
export default function UploadPage() {
  redirect('/chat');
}
