import type { Client, SanClientInfo } from '../types';
import type { ContactoCobros } from '../services/contactosCobrosService';

type ContactAutofillClient = Pick<
  Client,
  'code' | 'country' | 'contactPerson' | 'celular' | 'phone1' | 'phone2' | 'cell' | 'telefono' | 'email'
>;

export function resolveContactAutofill(
  client: ContactAutofillClient,
  contacts: ContactoCobros[],
  sanInfo: SanClientInfo | null,
  channel: string,
) {
  const matchingContacts = contacts.filter(
    (contact) => contact.codigo_cliente.toUpperCase() === client.code.toUpperCase()
      && contact.pais === client.country,
  );
  const primaryContact = matchingContacts.find(
    (contact) => contact.nombre || contact.telefono_fijo || contact.whatsapp || contact.correo,
  );
  const name = [
    primaryContact?.nombre,
    client.contactPerson,
    sanInfo?.contactName,
    sanInfo?.['CONTACTO COBROS'],
  ].find((value) => typeof value === 'string' && value.trim())?.trim() || '';
  const phone = (
    channel === 'WhatsApp'
      ? primaryContact?.whatsapp || primaryContact?.telefono_fijo
      : primaryContact?.telefono_fijo || primaryContact?.whatsapp
  ) || sanInfo?.['TELEFONO COBROS']
    || sanInfo?.['TELEFONO MOVIL']
    || client.celular
    || client.phone1
    || client.phone2
    || client.cell
    || client.telefono
    || '';
  const email = primaryContact?.correo || sanInfo?.['CORREO COBROS'] || client.email || '';

  return { name, phone, email };
}
